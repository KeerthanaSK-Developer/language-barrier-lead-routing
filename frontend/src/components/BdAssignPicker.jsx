import React, { useMemo, useState } from 'react';
import { UserPlus, RefreshCw } from 'lucide-react';
import { Spinner } from './Spinner';

const MAX_SLOTS = 3;

function langKey(l) {
  return String(l || '').trim().toLowerCase();
}

function leadLanguages(lead) {
  const out = [];
  const seen = new Set();
  const hasCall =
    Boolean(lead?.last_call_session_id || lead?.last_call_insights?.session_id);
  const callOnly = hasCall
    ? [...(lead?.callLanguages || []), ...(lead?.transcriptedLanguages || [])]
    : [];
  for (const raw of [lead?.preferred_language, ...callOnly]) {
    const k = langKey(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(raw).trim());
  }
  return out;
}

function bdSpeaks(bd, language) {
  const target = langKey(language);
  if (!target) return false;
  return (bd.supported_languages || []).some((l) => langKey(l) === target);
}

function bdHasFreeSlot(bd) {
  const count = Number(bd.active_lead_count ?? bd.activeLeadCount ?? 0);
  return count < MAX_SLOTS && bd.status !== 'inactive' && bd.availability !== false;
}

/**
 * Partition free BDs into same-language vs other free slots (client-side).
 */
export function partitionFreeBds(bds, lead) {
  const langs = leadLanguages(lead);
  const free = (bds || []).filter(bdHasFreeSlot);
  const matching = [];
  const other = [];
  for (const bd of free) {
    const match = langs.length === 0
      ? false
      : langs.some((lang) => bdSpeaks(bd, lang));
    if (match) matching.push(bd);
    else other.push(bd);
  }
  // If lead has no language at all, all free BDs appear under other
  if (langs.length === 0) {
    return { matching: [], other: free, langs };
  }
  return { matching, other, langs };
}

/**
 * Assign / Reassign picker: two sections — same language, other free slots.
 */
const BdAssignPicker = ({
  lead,
  bds,
  mode = 'assign', // assign | reassign
  onConfirm,
  onCancel,
  busy = false,
}) => {
  const [selectedBdId, setSelectedBdId] = useState('');
  const { matching, other } = useMemo(() => partitionFreeBds(bds, lead), [bds, lead]);

  const slotsLeft = (bd) =>
    Math.max(0, MAX_SLOTS - Number(bd.active_lead_count ?? 0));

  const renderGroup = (title, list) => (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-600 mb-1.5">{title}</p>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400">None available</p>
      ) : (
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {list.map((bd) => (
            <li key={bd.bd_id}>
              <label className="flex items-start gap-2 p-2 rounded border border-gray-100 hover:bg-gray-50 cursor-pointer text-sm">
                <input
                  type="radio"
                  name={`bd-pick-${lead?.id || 'x'}`}
                  className="mt-1"
                  checked={selectedBdId === bd.bd_id}
                  onChange={() => setSelectedBdId(bd.bd_id)}
                />
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">{bd.name}</span>
                  <span className="text-gray-500 text-xs block">
                    {(bd.supported_languages || []).join(', ') || 'No languages'}
                    {' · '}
                    {slotsLeft(bd)} free
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mt-3 p-3 rounded-lg border border-primary-100 bg-white">
      <p className="text-sm font-medium text-gray-900 mb-2">
        {mode === 'reassign' ? 'Reassign to BD' : 'Assign to BD'}
      </p>
      {renderGroup('Same language (free slots)', matching)}
      {renderGroup('Other free slots', other)}
      <div className="flex flex-wrap gap-2 mt-2">
        <button
          type="button"
          disabled={!selectedBdId || busy}
          onClick={() => onConfirm(selectedBdId)}
          className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1"
        >
          {busy ? <Spinner /> : mode === 'reassign' ? <RefreshCw className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
          {busy ? 'Saving…' : mode === 'reassign' ? 'Confirm reassign' : 'Confirm assign'}
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary text-xs py-1.5 px-3" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default BdAssignPicker;
