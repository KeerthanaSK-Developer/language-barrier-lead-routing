import React, { useState, useEffect, useCallback } from 'react';
import { leadsAPI, bdsAPI } from '../../services/api';
import BulkCsvUpload from '../../components/BulkCsvUpload';
import CopyNotice from '../../components/CopyNotice';
import Pagination from '../../components/Pagination';
import { Spinner, PageLoader } from '../../components/Spinner';
import { getErrorMessage } from '../../utils/errors';
import { Plus, Upload, RefreshCw, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';

const AdminLeads = () => {
  const [leads, setLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [assignLead, setAssignLead] = useState(null);
  const [selectedBdId, setSelectedBdId] = useState('');
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
    transcription: '',
  });
  const [leadNotice, setLeadNotice] = useState(null);
  const [detailLead, setDetailLead] = useState(null);

  const fetchLeads = useCallback(async (isRefresh = false, pageOverride, sizeOverride) => {
    const p = pageOverride ?? page;
    const size = sizeOverride ?? pageSize;
    try {
      if (isRefresh) setRefreshing(true);
      const response = await leadsAPI.getAll({ page: p, page_size: size });
      const data = response.data || {};
      setLeads(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 0);
      if (data.page) setPage(data.page);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load leads'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize]);

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
    const language = formData.preferred_language.trim();
    const transcription = formData.transcription.trim();
    if (!language && !transcription) {
      setFormError('Provide preferred language and/or call transcription');
      return;
    }
    try {
      setCreating(true);
      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        preferred_language: language || null,
        transcriptionData: transcription
          ? {
              callId: '',
              source: 'transcript_content',
              transcript: transcription,
            }
          : null,
      };
      const response = await leadsAPI.create(payload);
      const routed = Boolean(response.data.routing?.routed);
      const bdName = response.data.routing?.bd_name || '';
      const resolvedLang = response.data.lead?.preferred_language || language;
      const transcripted = response.data.lead?.transcriptedLanguages || [];
      const notice = {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        language: resolvedLang,
        transcripted: transcripted.join(', ') || '—',
        bdName: routed ? bdName : '',
      };
      setLeadNotice(notice);

      if (routed) {
        toast.success(`Lead created and auto-routed to ${bdName}. Copy the details below.`);
      } else {
        toast.error('Lead created but no BD available. Details stay on screen for 1 minute.');
      }

      setShowModal(false);
      setFormData({ name: '', email: '', phone: '', preferred_language: '', transcription: '' });
      fetchLeads();
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to create lead');
      setFormError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleManualAssign = async (e) => {
    e.preventDefault();
    if (!assignLead || !selectedBdId) return;
    setAssignError('');
    try {
      setAssigning(true);
      const res = await leadsAPI.manualAssign(assignLead.id, selectedBdId);
      const bd = bds.find((item) => item.bd_id === selectedBdId);
      setLeadNotice({
        name: assignLead.name || assignLead.lead_name || '',
        email: assignLead.email || '',
        phone: assignLead.phone || '',
        language: assignLead.preferred_language || '',
        bdName: bd?.name || 'BD',
      });
      const note = res.data.warning ? ` (${res.data.warning})` : '';
      toast.success(`Assigned to ${bd?.name || 'BD'}${note}. Copy the details below.`);
      setAssignLead(null);
      setSelectedBdId('');
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
    const [name, email, phone, preferred_language = '', transcription = ''] = row;
    const language = (preferred_language || '').trim();
    const transcript = String(transcription || '')
      .trim()
      .replace(/\\n/g, '\n');
    if (!language && !transcript) {
      throw new Error('Provide preferred_language and/or transcription');
    }
    const payload = {
      name: (name || '').trim(),
      email: (email || '').trim(),
      phone: (phone || '').trim(),
      preferred_language: language || null,
      transcriptionData: transcript
        ? { callId: '', source: 'transcript_content', transcript }
        : null,
    };
    const response = await leadsAPI.create(payload);
    const routed = Boolean(response.data.routing?.routed);
    const bdName = response.data.routing?.bd_name || '';
    const resolvedLang = response.data.lead?.preferred_language || language || 'detected';
    const reason = routed
      ? `Created & assigned to ${bdName}`
      : (response.data.routing?.reason || 'Created (pending assignment)');
    const copyText = [
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      `Language: ${resolvedLang}`,
      `Assigned BD: ${routed ? bdName : 'pending'}`,
    ].join('\n');
    return {
      reason,
      data: { ...payload, preferred_language: resolvedLang },
      copyText,
      copyLabel: 'Copy details',
    };
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

  const speaks = (bd, language) =>
    (bd.supported_languages || []).some(
      (l) => String(l).toLowerCase() === String(language || '').toLowerCase()
    );

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
            { label: 'Call Transcripted language', value: leadNotice.transcripted || '—' },
            { label: 'Assigned BD', value: leadNotice.bdName || 'Pending' },
          ]}
          copyText={[
            `Name: ${leadNotice.name}`,
            `Email: ${leadNotice.email}`,
            `Phone: ${leadNotice.phone}`,
            `Language: ${leadNotice.language}`,
            `Call Transcripted language: ${leadNotice.transcripted || '—'}`,
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
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Language</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Call Transcripted Language</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Assigned BD</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-8 text-center text-gray-500">
                    No leads found
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">
                      <button
                        type="button"
                        className="text-left text-primary-700 hover:underline font-medium"
                        onClick={() => setDetailLead(lead)}
                      >
                        {lead.name || lead.lead_name}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{lead.email || '-'}</td>
                    <td className="py-3 px-4 text-gray-600">{lead.phone || '-'}</td>
                    <td className="py-3 px-4">
                      <span className="badge badge-info">{lead.preferred_language || '-'}</span>
                    </td>
                    <td className="py-3 px-4">
                      {(lead.transcriptedLanguages || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {lead.transcriptedLanguages.map((lang) => (
                            <span key={lang} className="badge badge-warning">{lang}</span>
                          ))}
                        </div>
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
                      {isUnassigned(lead) ? (
                        <button
                          onClick={() => {
                            setAssignLead(lead);
                            setSelectedBdId('');
                            setAssignError('');
                          }}
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1"
                        >
                          <UserPlus className="w-4 h-4" />
                          Assign
                        </button>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
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
          <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6">
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
                <dt className="text-gray-500">Preferred language</dt>
                <dd>
                  <span className="badge badge-info">{detailLead.preferred_language || '-'}</span>
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 mb-1">Call Transcripted language</dt>
                <dd className="flex flex-wrap gap-1">
                  {(detailLead.transcriptedLanguages || []).length > 0 ? (
                    detailLead.transcriptedLanguages.map((lang) => (
                      <span key={lang} className="badge badge-warning">{lang}</span>
                    ))
                  ) : (
                    <span className="text-gray-400">None detected</span>
                  )}
                </dd>
              </div>
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
              {detailLead.transcriptionData?.transcript && (
                <div>
                  <dt className="text-gray-500 mb-1">
                    Call transcript
                    {detailLead.transcriptionData.callId
                      ? ` · ${detailLead.transcriptionData.callId}`
                      : ''}
                  </dt>
                  <dd className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
                      {detailLead.transcriptionData.transcript}
                    </pre>
                  </dd>
                </div>
              )}
            </dl>
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
                  Preferred Language <span className="text-gray-400 font-normal">(or transcription below)</span>
                </label>
                <input
                  type="text"
                  value={formData.preferred_language}
                  onChange={(e) => setFormData({ ...formData, preferred_language: e.target.value })}
                  className="input-field"
                  placeholder="e.g. Tamil, Hindi, English"
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Call transcription <span className="text-gray-400 font-normal">(optional if language set)</span>
                </label>
                <textarea
                  value={formData.transcription}
                  onChange={(e) => setFormData({ ...formData, transcription: e.target.value })}
                  className="input-field min-h-[100px]"
                  placeholder={"Agent: Good morning...\nLearner: Vanakkam..."}
                  disabled={creating}
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI detects language from the transcript if language is empty or mixed.
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
            <h2 className="text-xl font-semibold mb-1">Manual Assign</h2>
            <p className="text-sm text-gray-500 mb-4">
              {assignLead.name || assignLead.lead_name} · {assignLead.preferred_language}
            </p>
            {assignError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {assignError}
              </div>
            )}
            <form onSubmit={handleManualAssign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign to BD *</label>
                <select
                  value={selectedBdId}
                  onChange={(e) => setSelectedBdId(e.target.value)}
                  className="input-field"
                  required
                  disabled={assigning}
                >
                  <option value="">Select BD</option>
                  {bds.map((bd) => {
                    const capacity = bd.available_capacity ?? Math.max(0, 3 - (bd.active_lead_count || 0));
                    const match = speaks(bd, assignLead.preferred_language);
                    return (
                      <option key={bd.bd_id} value={bd.bd_id} disabled={capacity <= 0}>
                        {bd.name}
                        {match ? ' ✓ lang' : ''} · {capacity} slots
                        {capacity <= 0 ? ' (full)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignLead(null)}
                  className="btn-secondary flex-1"
                  disabled={assigning}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={assigning || !selectedBdId}
                >
                  {assigning ? (
                    <>
                      <Spinner />
                      Assigning...
                    </>
                  ) : (
                    'Assign Lead'
                  )}
                </button>
              </div>
            </form>
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
            { key: 'preferred_language', label: 'preferred_language (optional if transcription)' },
            { key: 'transcription', label: 'transcription (Agent:\\nLearner — optional if language)' },
          ]}
          exampleRows={[
            ['Ravi Krishnan', 'ravi@example.com', '9876543210', 'Tamil', ''],
            ['Yuki Tanaka', 'yuki@example.com', '9123456780', '', 'Agent: Hello\nLearner: Vanakkam'],
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
