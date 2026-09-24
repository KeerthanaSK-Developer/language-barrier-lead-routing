import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Video, RefreshCw, ExternalLink, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { callsAPI } from '../services/api';
import { Spinner } from './Spinner';
import { getErrorMessage } from '../utils/errors';

const FETCH_AFTER_START_MS = 5 * 60 * 1000;
const LIVE_POLL_MS = 4000;

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStartEnd() {
  const start = new Date();
  start.setMinutes(start.getMinutes() + 15);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 45 * 60 * 1000);
  return { start: toLocalInputValue(start), end: toLocalInputValue(end) };
}

function parseTime(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function fetchAvailableAt(session) {
  if (session?.fetch_available_at) {
    const t = parseTime(session.fetch_available_at);
    if (t != null) return t;
  }
  const start = parseTime(session?.start_time);
  if (start == null) return null;
  return start + FETCH_AFTER_START_MS;
}

function canFetchRecordings(session, nowMs) {
  if (!session || session.status === 'cancelled') return false;
  if (typeof session.can_fetch_recordings === 'boolean') {
    // Re-evaluate locally so the button unlocks without a refresh
    const at = fetchAvailableAt(session);
    if (at == null) return session.can_fetch_recordings;
    return nowMs >= at;
  }
  const at = fetchAvailableAt(session);
  return at != null && nowMs >= at;
}

function isProcessing(session) {
  return ['queued', 'transcribing', 'analyzing'].includes(session?.processing_status);
}

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function isVideoUrl(url) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url || '');
}

function RecordingClip({ url, title, meta }) {
  return (
    <li className="rounded border border-gray-200 bg-white p-2">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-blue-600 hover:underline break-all text-xs"
      >
        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
        {title}
      </a>
      {meta ? <p className="text-[11px] text-gray-400 mt-0.5">{meta}</p> : null}
      {isVideoUrl(url) && (
        <video
          className="mt-2 w-full max-h-48 rounded bg-black"
          controls
          preload="metadata"
          src={url}
        >
          Your browser does not support video playback.
        </video>
      )}
    </li>
  );
}

function formatWhen(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Schedule Classify video calls for a lead.
 * Each scheduled session is a separate meeting (Meeting 1, Meeting 2, …).
 * Split recording URLs within one meeting are parts of that same meeting only.
 * Lead table fields always mirror the latest meeting’s insights.
 */
const CallSchedulePanel = ({ leadId, leadName, onInsightsReady, showAiInsights = true }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [fetchingId, setFetchingId] = useState(null);
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const notifiedReadyRef = useRef(new Set());
  const defaults = useMemo(() => defaultStartEnd(), []);
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);

  const load = useCallback(async () => {
    if (!leadId) return;
    try {
      const res = await callsAPI.list({ lead_id: leadId });
      setSessions(res.data?.items || []);
    } catch (e) {
      // silent on list — panel is secondary
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Tick so the Fetch button unlocks at start+5m without manual refresh
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live poll while any session is processing (incl. queued)
  const needsLivePoll = sessions.some(
    (s) => isProcessing(s) || s?.processing_status === 'queued'
  );
  useEffect(() => {
    if (!needsLivePoll || !leadId) return undefined;
    const id = setInterval(() => {
      load();
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [needsLivePoll, leadId, load]);

  // Allow re-notify after Fetch/reprocess (status leaves ready)
  useEffect(() => {
    sessions.forEach((s) => {
      if (isProcessing(s) || s?.processing_status === 'queued') {
        notifiedReadyRef.current.delete(s.id);
      }
    });
  }, [sessions]);

  // When a session newly becomes ready, refresh parent lead fields (no page reload)
  useEffect(() => {
    if (!onInsightsReady) return;
    sessions.forEach((s) => {
      if (s.processing_status === 'ready' && s.insights && !notifiedReadyRef.current.has(s.id)) {
        notifiedReadyRef.current.add(s.id);
        onInsightsReady(s);
      }
    });
  }, [sessions, onInsightsReady]);

  const handleSchedule = async (e) => {
    e.preventDefault();
    if (!startTime || !endTime) {
      toast.error('Pick start and end time');
      return;
    }
    if (new Date(endTime) <= new Date(startTime)) {
      toast.error('End time must be after start time');
      return;
    }
    try {
      setScheduling(true);
      const res = await callsAPI.schedule({
        lead_id: leadId,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        label: `BD call — ${leadName || 'Lead'}`,
        auto_recording_start: 'on',
      });
      toast.success('Video call scheduled');
      setOpen(false);
      await load();
      const join = res.data?.session?.join_url;
      if (join) {
        toast.success('Join link ready', { duration: 4000 });
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to schedule call'));
    } finally {
      setScheduling(false);
    }
  };

  const handleFetch = async (sessionId) => {
    try {
      setFetchingId(sessionId);
      const res = await callsAPI.fetchAttendance(sessionId);
      toast.success(res.data?.message || 'Attendance fetched');
      await load();
    } catch (err) {
      const msg = getErrorMessage(err, 'Try again after some time');
      toast.error(msg.includes('try') || msg.includes('progress') || msg.includes('time') || msg.includes('Fetch available')
        ? msg
        : `${msg} — try again after some time`);
    } finally {
      setFetchingId(null);
    }
  };

  // Sessions are newest-first from API. Meeting 1 = earliest, Meeting N = latest.
  const meetingNumber = (callIdx) => sessions.length - callIdx;
  const latestSessionId = sessions[0]?.id;

  return (
    <div className="mt-3 border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <Video className="w-4 h-4 text-primary-600 shrink-0" />
            Meetings with this lead
            {sessions.length > 0 && (
              <span className="text-xs font-normal text-gray-500">
                ({sessions.length} separate meeting{sessions.length === 1 ? '' : 's'})
              </span>
            )}
          </div>
          {sessions.length > 1 && (
            <p className="text-[11px] text-gray-500 mt-0.5 ml-6">
              Meeting 1 and Meeting 2 are different Classify calls with the same person.
              Lead table uses the latest meeting’s results; recordings appear under each meeting below.
            </p>
          )}
          <p className="text-[11px] text-gray-500 mt-1 ml-6">
            Fetch unlocks 5 min after start — transcription starts if a recording URL exists.
            If you don’t fetch, the server retries automatically at end+5m and end+10m.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
        >
          <Calendar className="w-3.5 h-3.5" />
          {open ? 'Cancel' : 'Schedule call'}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSchedule} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start</label>
            <input
              type="datetime-local"
              className="input w-full text-sm"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End</label>
            <input
              type="datetime-local"
              className="input w-full text-sm"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={scheduling}
              className="btn-primary text-sm w-full sm:w-auto flex items-center justify-center gap-2"
            >
              {scheduling ? <><Spinner /> Scheduling…</> : 'Create Classify meeting'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 mt-3">Loading meetings…</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-gray-400 mt-3">No meetings scheduled for this lead yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {sessions.map((s, callIdx) => {
            const availableAt = fetchAvailableAt(s);
            const fetchReady = canFetchRecordings(s, nowMs);
            const waitMs = availableAt != null ? availableAt - nowMs : null;
            const processing = isProcessing(s);
            const progress = s.processing_progress || {};
            const recordings = (s.recordings || []).filter((r) => r?.url);
            const isLatest = s.id === latestSessionId;
            const meetNum = meetingNumber(callIdx);

            return (
              <li
                key={s.id}
                className={`rounded-md border p-3 text-sm ${
                  isLatest ? 'border-primary-200 bg-primary-50/30' : 'border-gray-100 bg-gray-50'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                      <span>Meeting {meetNum}</span>
                      {isLatest && (
                        <span className="badge badge-info text-[10px]">Latest meeting</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">
                      {s.label || 'Classify meeting'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatWhen(s.start_time)} → {formatWhen(s.end_time)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Status: {s.status}
                      {s.processing_status ? ` · ${s.processing_status}` : ''}
                      {s.unique_id ? ` · ${String(s.unique_id).slice(0, 8)}…` : ''}
                    </p>
                    {!fetchReady && waitMs != null && waitMs > 0 && s.status !== 'cancelled' && (
                      <p className="text-xs text-amber-700 mt-1">
                        Fetch unlocks 5 min after start · available in {formatCountdown(waitMs)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.join_url && (
                      <a
                        href={s.join_url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary text-xs py-1.5 px-2 inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Join
                      </a>
                    )}
                    {fetchReady && (
                      <button
                        type="button"
                        onClick={() => handleFetch(s.id)}
                        disabled={fetchingId === s.id}
                        className="btn-primary text-xs py-1.5 px-2 inline-flex items-center gap-1"
                        title="Pull latest attendance & all recording URLs from Classify"
                      >
                        {fetchingId === s.id ? (
                          <><Spinner /> Fetching…</>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            {s.attendance_fetched ? 'Refresh recordings' : 'Fetch recordings'}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {processing && (
                  <div className="mt-2 rounded border border-blue-100 bg-blue-50 px-2 py-1.5 text-xs text-blue-900 flex items-center gap-2">
                    <Spinner />
                    <span>
                      {progress.message
                        || (progress.total
                          ? `Processing recording ${progress.current || 0} of ${progress.total}`
                          : `Processing… (${s.processing_status})`)}
                    </span>
                  </div>
                )}

                {(s.attendance_fetched || recordings.length > 0) && (
                  <div className="mt-2 text-xs text-gray-600 space-y-1">
                    {s.minimum_attendance_time != null && (
                      <p>Min attendance: {s.minimum_attendance_time} min</p>
                    )}
                    <p className="font-medium text-gray-700">
                      Videos from this meeting: {recordings.length}
                      {recordings.length === 0
                        ? ' (none yet — refresh later)'
                        : recordings.length > 1
                          ? ' (split parts of this same meeting)'
                          : ''}
                    </p>
                    {recordings.length > 0 && (
                      <ul className="mt-1 space-y-1.5">
                        {recordings.map((r, i) => (
                          <RecordingClip
                            key={`${r.url}-${i}`}
                            url={r.url}
                            title={
                              recordings.length > 1
                                ? `Meeting ${meetNum} · part ${i + 1} of ${recordings.length}`
                                : `Meeting ${meetNum} · recording`
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {showAiInsights && (s.insights || s.interested != null) && (
                  <div className="mt-2 p-2 rounded bg-white border border-amber-100">
                    <div className="flex items-center gap-1 text-xs font-medium text-amber-900 mb-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      Insights for Meeting {meetNum}
                      {isLatest ? ' · used on lead table' : ''}
                    </div>
                    <p className="text-xs text-gray-800">
                      {typeof s.insights?.join_probability === 'number'
                        ? `Join probability: ${s.insights.join_probability}%`
                        : null}
                    </p>
                    {s.insights?.summary && (
                      <p className="text-xs text-gray-600 mt-1">{s.insights.summary}</p>
                    )}
                    {(s.insights?.next_actions_for_bda || []).length > 0 && (
                      <div className="mt-1">
                        <p className="text-[11px] font-medium text-gray-500">BDA next steps</p>
                        <ul className="text-xs text-gray-600 list-disc pl-4">
                          {s.insights.next_actions_for_bda.slice(0, 3).map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(s.insights?.next_actions_for_bdm || []).length > 0 && (
                      <div className="mt-1">
                        <p className="text-[11px] font-medium text-gray-500">BDM</p>
                        <ul className="text-xs text-gray-600 list-disc pl-4">
                          {s.insights.next_actions_for_bdm.slice(0, 2).map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(s.insights?.marketing_insights || []).length > 0 && (
                      <div className="mt-1">
                        <p className="text-[11px] font-medium text-gray-500">Marketing</p>
                        <ul className="text-xs text-gray-600 list-disc pl-4">
                          {s.insights.marketing_insights.slice(0, 2).map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {s.processing_error && (
                  <p className="mt-1 text-xs text-red-600">{s.processing_error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CallSchedulePanel;
