import React, { useState, useEffect, useCallback } from 'react';
import { leadsAPI, bdsAPI } from '../../services/api';
import BulkCsvUpload from '../../components/BulkCsvUpload';
import CopyNotice from '../../components/CopyNotice';
import Pagination from '../../components/Pagination';
import CallSchedulePanel from '../../components/CallSchedulePanel';
import BdAssignPicker from '../../components/BdAssignPicker';
import LeadCallInsightsCard from '../../components/LeadCallInsightsCard';
import { Spinner, PageLoader } from '../../components/Spinner';
import { getErrorMessage } from '../../utils/errors';
import { Plus, Upload, RefreshCw, UserPlus, RefreshCcw, Eye } from 'lucide-react';
import toast from 'react-hot-toast';

const AdminLeads = () => {
  const [leads, setLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [assignLead, setAssignLead] = useState(null);
  const [assignMode, setAssignMode] = useState('assign'); // assign | reassign
  const [assigning, setAssigning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [assignError, setAssignError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    preferred_language: '',
  });
  const [leadNotice, setLeadNotice] = useState(null);
  const [detailLead, setDetailLead] = useState(null);
  const [langSaving, setLangSaving] = useState(false);
  const [langEditing, setLangEditing] = useState(false);
  const [editPreferred, setEditPreferred] = useState('');
  const [editCallLangs, setEditCallLangs] = useState('');

  const fetchLeads = useCallback(async (isRefresh = false, pageOverride, sizeOverride) => {
    const p = pageOverride ?? page;
    const size = sizeOverride ?? pageSize;
    try {
      if (isRefresh) setRefreshing(true);
      const response = await leadsAPI.getAll({ page: p, page_size: size });
      const data = response.data || {};
      const items = data.items || [];
      setLeads(items);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 0);
      if (data.page) setPage(data.page);
      // Keep open detail modal in sync (call language / join % after transcription)
      setDetailLead((prev) => {
        if (!prev?.id) return prev;
        return items.find((l) => l.id === prev.id) || prev;
      });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load leads'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize]);

  const applySessionInsightsToLead = useCallback((session) => {
    if (!session?.lead_id) return;
    const insights = session.insights || {};
    const langs = insights.languages_detected || [];
    const sessionUrls = (session.recordings || [])
      .map((r) => (typeof r === 'string' ? r : r?.url))
      .filter(Boolean);
    const patch = {
      ...(langs.length
        ? { callLanguages: langs, transcriptedLanguages: langs }
        : {}),
      ...(session.insights
        ? {
            last_call_insights: insights,
            call_join_probability: insights.join_probability,
            call_interest_level: insights.interest_level,
            call_interested: insights.interested,
          }
        : {}),
    };
    setLeads((prev) =>
      prev.map((l) => {
        if (l.id !== session.lead_id) return l;
        const mergedUrls = [
          ...new Set([...(l.call_recording_urls || []), ...sessionUrls]),
        ];
        return {
          ...l,
          ...patch,
          ...(mergedUrls.length
            ? { call_recording_urls: mergedUrls, call_recording_count: mergedUrls.length }
            : {}),
        };
      })
    );
    setDetailLead((prev) => {
      if (prev?.id !== session.lead_id) return prev;
      const mergedUrls = [
        ...new Set([...(prev.call_recording_urls || []), ...sessionUrls]),
      ];
      return {
        ...prev,
        ...patch,
        ...(mergedUrls.length
          ? { call_recording_urls: mergedUrls, call_recording_count: mergedUrls.length }
          : {}),
      };
    });
  }, []);

  const handleInsightsReady = useCallback(
    (session) => {
      applySessionInsightsToLead(session);
      fetchLeads(true);
    },
    [applySessionInsightsToLead, fetchLeads]
  );

  const fetchBDs = async () => {
    try {
      const response = await bdsAPI.getAll({ page: 1, page_size: 100 });
      const items = response.data?.items || [];
      setBds(items.filter((bd) => bd.status !== 'inactive'));
    } catch (error) {
      // non-blocking
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetchBDs();
  }, []);

  const handlePageChange = (nextPage) => {
    setPage(nextPage);
  };

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setPage(1);
  };

  const handleCreateLead = async (e) => {
    e.preventDefault();
    setFormError('');
    try {
      setCreating(true);
      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        preferred_language: formData.preferred_language.trim() || null,
      };
      const response = await leadsAPI.create(payload);
      const resolvedLang = response.data.lead?.preferred_language || payload.preferred_language || '—';
      setLeadNotice({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        language: resolvedLang,
        bdName: '',
      });
      toast.success('Lead created — assign a BD when ready');
      setShowModal(false);
      setFormData({ name: '', email: '', phone: '', preferred_language: '' });
      fetchLeads();
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to create lead');
      setFormError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleManualAssign = async (bdId) => {
    if (!assignLead || !bdId) return;
    setAssignError('');
    try {
      setAssigning(true);
      const isReassign = assignMode === 'reassign';
      const res = isReassign
        ? await leadsAPI.reassign(assignLead.id, bdId)
        : await leadsAPI.manualAssign(assignLead.id, bdId);
      const bd = bds.find((item) => item.bd_id === bdId);
      setLeadNotice({
        name: assignLead.name || assignLead.lead_name || '',
        email: assignLead.email || '',
        phone: assignLead.phone || '',
        language: assignLead.preferred_language || '',
        bdName: bd?.name || res.data.bd_name || 'BD',
      });
      const note = res.data.warning ? ` (${res.data.warning})` : '';
      toast.success(`${isReassign ? 'Reassigned' : 'Assigned'} to ${bd?.name || 'BD'}${note}`);
      setAssignLead(null);
      setAssignMode('assign');
      fetchLeads();
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to assign lead');
      setAssignError(msg);
      toast.error(msg);
    } finally {
      setAssigning(false);
    }
  };

  const processLeadRow = async (row) => {
    const [name, email, phone, preferred_language = ''] = row;
    const language = (preferred_language || '').trim();
    const payload = {
      name: (name || '').trim(),
      email: (email || '').trim(),
      phone: (phone || '').trim(),
      preferred_language: language || null,
    };
    const response = await leadsAPI.create(payload);
    const resolvedLang = response.data.lead?.preferred_language || language || '—';
    const copyText = [
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      `Language: ${resolvedLang}`,
      `Assigned BD: pending`,
    ].join('\n');
    return {
      reason: 'Created — awaiting manual assignment',
      data: { ...payload, preferred_language: resolvedLang },
      copyText,
      copyLabel: 'Copy details',
    };
  };

  const openDetail = (lead) => {
    setDetailLead(lead);
    setLangEditing(false);
    setEditPreferred(lead.preferred_language || '');
    setEditCallLangs(callLangs(lead).join(', '));
  };

  const cancelLangEdit = () => {
    if (!detailLead) return;
    setLangEditing(false);
    setEditPreferred(detailLead.preferred_language || '');
    setEditCallLangs(callLangs(detailLead).join(', '));
  };

  const handleSaveLanguages = async () => {
    if (!detailLead?.id) return;
    try {
      setLangSaving(true);
      const payload = {
        preferred_language: editPreferred.trim() || null,
      };
      const existingCall = callLangs(detailLead);
      if (existingCall.length > 0) {
        const parsed = editCallLangs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parsed.length === 0) {
          toast.error('Call language needs at least one value');
          return;
        }
        payload.callLanguages = parsed;
      }
      const res = await leadsAPI.update(detailLead.id, payload);
      const updated = res.data;
      setDetailLead(updated);
      setEditPreferred(updated.preferred_language || '');
      setEditCallLangs((updated.callLanguages || []).join(', '));
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
      setLangEditing(false);
      toast.success('Languages updated');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update languages'));
    } finally {
      setLangSaving(false);
    }
  };

  const getStatusBadge = (status) => {
    const classes = {
      new: 'badge-info',
      pending: 'badge-warning',
      assigned: 'badge-success',
      in_progress: 'badge-info',
      completed: 'badge-success',
    };
    return classes[status] || 'badge-gray';
  };

  const isUnassigned = (lead) =>
    !lead.assigned_bd && ['new', 'pending'].includes(lead.status);

  const hasProcessedCall = (lead) =>
    Boolean(lead?.last_call_session_id || lead?.last_call_insights?.session_id);

  const callLangs = (lead) => {
    // Only after a real processed call — never show preferred as call language
    if (!hasProcessedCall(lead)) return [];
    return lead.callLanguages?.length
      ? lead.callLanguages
      : lead.transcriptedLanguages || [];
  };

  const joinProbability = (lead) => {
    const v = lead.call_join_probability ?? lead.last_call_insights?.join_probability;
    return v != null && v !== '' ? Number(v) : null;
  };

  const reassignSourceLabel = (lead) => {
    const src = lead.reassign_source || '';
    if (src === 'bd') return 'BDA';
    if (src === 'ai_language_barrier') return 'AI · language barrier';
    if (src === 'ai_cooperation') return 'AI · BDA engagement';
    if (src === 'ai_not_interested') return 'AI · not interested';
    if (src.startsWith('ai')) return 'AI';
    return src || 'Request';
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">All Leads</h1>
          <p className="text-gray-500 mt-1 text-sm sm:text-base">Manage and route business leads</p>
        </div>
        <div className="page-actions">
          <button onClick={() => setShowBulkModal(true)} className="btn-secondary flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Bulk Upload
          </button>
          <button
            onClick={() => fetchLeads(true)}
            disabled={refreshing}
            className="btn-secondary flex items-center gap-2"
          >
            {refreshing ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          <button
            onClick={() => {
              setFormError('');
              setShowModal(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Lead
          </button>
        </div>
      </div>

      {leadNotice && (
        <CopyNotice
          title={leadNotice.bdName ? `Lead assigned to ${leadNotice.bdName}` : 'Lead created — not assigned yet'}
          hint="Copy these details and send them to the BD."
          lines={[
            { label: 'Name', value: leadNotice.name },
            { label: 'Email', value: leadNotice.email },
            { label: 'Phone', value: leadNotice.phone },
            { label: 'Language', value: leadNotice.language },
            { label: 'Assigned BD', value: leadNotice.bdName || 'Pending' },
          ]}
          copyText={[
            `Name: ${leadNotice.name}`,
            `Email: ${leadNotice.email}`,
            `Phone: ${leadNotice.phone}`,
            `Language: ${leadNotice.language}`,
            `Assigned BD: ${leadNotice.bdName || 'Pending'}`,
          ].join('\n')}
          copyLabel="Copy details"
          onExpire={() => setLeadNotice(null)}
        />
      )}

      <div className="card overflow-hidden p-0">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Name</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Email</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Contact</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Preferred language</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Call language (latest)</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Join % (latest)</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Assigned BD</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan="9" className="py-8 text-center text-gray-500">
                    No leads found
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">
                      {lead.name || lead.lead_name}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{lead.email || '-'}</td>
                    <td className="py-3 px-4 text-gray-600">{lead.phone || '-'}</td>
                    <td className="py-3 px-4">
                      <span className="badge badge-info">{lead.preferred_language || '—'}</span>
                    </td>
                    <td className="py-3 px-4">
                      {callLangs(lead).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {callLangs(lead).map((lang) => (
                            <span key={lang} className="badge badge-warning">{lang}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {joinProbability(lead) != null && !Number.isNaN(joinProbability(lead)) ? (
                        <span className="badge badge-info">{joinProbability(lead)}%</span>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {lead.assigned_bd_name || <span className="text-gray-400 italic">Unassigned</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${getStatusBadge(lead.status)}`}>{lead.status}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1.5 items-start">
                        <button
                          type="button"
                          onClick={() => openDetail(lead)}
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium inline-flex items-center gap-1"
                        >
                          <Eye className="w-4 h-4" />
                          Details
                        </button>
                        {isUnassigned(lead) ? (
                          <button
                            onClick={() => {
                              setAssignLead(lead);
                              setAssignMode('assign');
                              setAssignError('');
                            }}
                            className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1"
                          >
                            <UserPlus className="w-4 h-4" />
                            Assign
                          </button>
                        ) : lead.reassign_requested ? (
                          <button
                            onClick={() => {
                              setAssignLead(lead);
                              setAssignMode('reassign');
                              setAssignError('');
                            }}
                            className="text-amber-700 hover:text-amber-800 text-sm font-medium inline-flex items-center gap-1"
                            title="Open reassign — reason shown in modal"
                          >
                            <RefreshCcw className="w-4 h-4" />
                            Reassign
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          disabled={loading || refreshing}
        />
      </div>

      {detailLead && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {detailLead.name || detailLead.lead_name}
                </h2>
                <p className="text-sm text-gray-500 mt-1">{detailLead.email}</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setDetailLead(null)}>
                Close
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Contact</dt>
                <dd className="font-medium text-gray-900">{detailLead.phone || '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 mb-1">Preferred language</dt>
                <dd>
                  <input
                    type="text"
                    className="input-field text-sm disabled:bg-gray-100 disabled:text-gray-600"
                    value={editPreferred}
                    onChange={(e) => setEditPreferred(e.target.value)}
                    placeholder="Any language (e.g. Hindi, Tamil)"
                    disabled={!langEditing}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 mb-1">Call language (latest call)</dt>
                <dd>
                  {callLangs(detailLead).length > 0 ? (
                    <input
                      type="text"
                      className="input-field text-sm disabled:bg-gray-100 disabled:text-gray-600"
                      value={editCallLangs}
                      onChange={(e) => setEditCallLangs(e.target.value)}
                      placeholder="Comma-separated, e.g. English, Hindi"
                      disabled={!langEditing}
                    />
                  ) : (
                    <span className="text-gray-400 text-sm">
                      None yet — editable after a call is processed
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                {!langEditing ? (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setLangEditing(true)}
                  >
                    Enable language edit
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-primary text-xs inline-flex items-center gap-1"
                      onClick={handleSaveLanguages}
                      disabled={langSaving}
                    >
                      {langSaving ? <Spinner /> : null}
                      Save languages
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={cancelLangEdit}
                      disabled={langSaving}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
              <div>
                <dt className="text-gray-500">Join probability (latest call)</dt>
                <dd className="font-medium text-gray-900">
                  {joinProbability(detailLead) != null && !Number.isNaN(joinProbability(detailLead))
                    ? `${joinProbability(detailLead)}%`
                    : '—'}
                </dd>
              </div>
              {detailLead.reassign_requested && (
                <div className="p-2 rounded bg-amber-50 border border-amber-200">
                  <p className="text-xs font-medium text-amber-900">
                    Reassign · {reassignSourceLabel(detailLead)}
                  </p>
                  <p className="text-sm text-amber-800 mt-0.5">
                    {detailLead.reassign_reason || '—'}
                  </p>
                  <button
                    type="button"
                    className="btn-primary text-xs mt-2"
                    onClick={() => {
                      setAssignLead(detailLead);
                      setAssignMode('reassign');
                      setAssignError('');
                    }}
                  >
                    Reassign
                  </button>
                </div>
              )}
              <div>
                <dt className="text-gray-500">Status</dt>
                <dd>
                  <span className={`badge ${getStatusBadge(detailLead.status)}`}>{detailLead.status}</span>
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Assigned BD</dt>
                <dd className="font-medium text-gray-900">{detailLead.assigned_bd_name || 'Unassigned'}</dd>
              </div>
            </dl>

            <LeadCallInsightsCard lead={detailLead} />
            <CallSchedulePanel
              leadId={detailLead.id}
              leadName={detailLead.name || detailLead.lead_name}
              onInsightsReady={handleInsightsReady}
            />
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-md w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            <h2 className="text-xl font-semibold mb-4">Add New Lead</h2>
            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {formError}
              </div>
            )}
            <form onSubmit={handleCreateLead} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  required
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field"
                  required
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Contact Number *</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input-field"
                  required
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Language <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formData.preferred_language}
                  onChange={(e) => setFormData({ ...formData, preferred_language: e.target.value })}
                  className="input-field"
                  placeholder="e.g. Tamil, Hindi, English"
                  disabled={creating}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Call language is filled automatically after the video call is processed.
                </p>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={creating}
                >
                  {creating ? (
                    <>
                      <Spinner />
                      Creating...
                    </>
                  ) : (
                    'Create Lead'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {assignLead && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-md w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            <h2 className="text-xl font-semibold mb-1">
              {assignMode === 'reassign' ? 'Reassign lead' : 'Assign lead'}
            </h2>
            <p className="text-sm text-gray-500 mb-3">
              {assignLead.name || assignLead.lead_name}
            </p>

            <dl className="grid grid-cols-2 gap-3 text-sm mb-3">
              <div>
                <dt className="text-xs text-gray-500">Preferred language</dt>
                <dd>
                  <span className="badge badge-info">{assignLead.preferred_language || '—'}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Call language</dt>
                <dd className="flex flex-wrap gap-1 mt-0.5">
                  {callLangs(assignLead).length > 0 ? (
                    callLangs(assignLead).map((lang) => (
                      <span key={lang} className="badge badge-warning">{lang}</span>
                    ))
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">Join probability</dt>
                <dd className="font-medium text-gray-900">
                  {joinProbability(assignLead) != null && !Number.isNaN(joinProbability(assignLead))
                    ? `${joinProbability(assignLead)}%`
                    : '—'}
                </dd>
              </div>
            </dl>

            {assignMode === 'reassign' && (
              <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  Reassign reason · {reassignSourceLabel(assignLead)}
                </p>
                <p className="leading-snug">{assignLead.reassign_reason || 'Requested'}</p>
              </div>
            )}

            {assignError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {assignError}
              </div>
            )}
            <BdAssignPicker
              lead={assignLead}
              bds={bds}
              mode={assignMode}
              busy={assigning}
              onConfirm={handleManualAssign}
              onCancel={() => {
                setAssignLead(null);
                setAssignMode('assign');
              }}
            />
          </div>
        </div>
      )}

      {showBulkModal && (
        <BulkCsvUpload
          title="Bulk Upload Leads"
          columns={[
            { key: 'name', label: 'name' },
            { key: 'email', label: 'email' },
            { key: 'phone', label: 'contact number' },
            { key: 'preferred_language', label: 'preferred_language (optional)' },
          ]}
          exampleRows={[
            ['Ravi Krishnan', 'ravi@example.com', '9876543210', 'Tamil'],
            ['Yuki Tanaka', 'yuki@example.com', '9123456780', ''],
          ]}
          processRow={processLeadRow}
          resultColumns={[
            { key: 'row', label: 'row' },
            { key: 'name', label: 'name' },
            { key: 'email', label: 'email' },
            { key: 'phone', label: 'phone' },
            { key: 'preferred_language', label: 'preferred_language' },
            { key: 'status', label: 'status' },
            { key: 'reason', label: 'reason' },
          ]}
          onComplete={() => fetchLeads()}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
};

export default AdminLeads;
