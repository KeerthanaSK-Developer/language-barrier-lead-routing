import React, { useState, useEffect, useCallback } from 'react';
import { leadsAPI } from '../../services/api';
import { FileText, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Spinner, PageLoader } from '../../components/Spinner';
import Pagination from '../../components/Pagination';
import CallSchedulePanel from '../../components/CallSchedulePanel';
import { getErrorMessage } from '../../utils/errors';

const BDLeads = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState(null);
  const [reassignId, setReassignId] = useState(null);
  const [reassignReason, setReassignReason] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchMyLeads = useCallback(async () => {
    try {
      const response = await leadsAPI.getMyLeads({ page, page_size: pageSize });
      const data = response.data || {};
      setLeads(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 0);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load your leads'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  const handleInsightsReady = useCallback(
    (session) => {
      if (session?.lead_id && session?.insights) {
        const insights = session.insights;
        const langs = insights.languages_detected || [];
        const patch = {
          callLanguages: langs,
          transcriptedLanguages: langs,
          last_call_insights: insights,
          call_join_probability: insights.join_probability,
          call_interest_level: insights.interest_level,
          call_interested: insights.interested,
        };
        setLeads((prev) =>
          prev.map((l) => (l.id === session.lead_id ? { ...l, ...patch } : l))
        );
      }
      fetchMyLeads();
    },
    [fetchMyLeads]
  );

  useEffect(() => {
    setLoading(true);
    fetchMyLeads();
  }, [fetchMyLeads]);

  const handleCompleteLead = async (leadId) => {
    try {
      setCompletingId(leadId);
      await leadsAPI.complete(leadId);
      toast.success('Lead marked as completed');
      await fetchMyLeads();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to complete lead'));
    } finally {
      setCompletingId(null);
    }
  };

  const handleRequestReassign = async (leadId) => {
    try {
      setReassignId(leadId);
      const reason = (reassignReason[leadId] || '').trim();
      await leadsAPI.requestReassign(leadId, reason);
      toast.success('Reassign request sent to admin');
      await fetchMyLeads();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to request reassign'));
    } finally {
      setReassignId(null);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const callLangs = (lead) => {
    const hasCall = Boolean(
      lead?.last_call_session_id || lead?.last_call_insights?.session_id
    );
    if (!hasCall) return [];
    return lead.callLanguages?.length
      ? lead.callLanguages
      : lead.transcriptedLanguages || [];
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Leads</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          Manage assigned leads, schedule calls, and request reassignment when needed
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <Clock className="w-5 h-5 text-blue-600 mt-0.5" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-900">Manual assignment</p>
            <p className="text-sm text-blue-700 mt-1">
              New leads are assigned by admin. After a call, AI may flag language barrier or cooperation
              issues; you can also request reassignment with a reason.
            </p>
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="card text-center py-12">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 text-lg">No active leads assigned</p>
          <p className="text-gray-400 text-sm mt-2">Ask admin to assign a lead to you</p>
        </div>
      ) : (
        <div className="space-y-4">
          {leads.map((lead) => (
            <div key={lead.id} className="card border-l-4 border-primary-500">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                    <h3 className="font-semibold text-gray-900">{lead.name || lead.lead_name}</h3>
                    <span className={`badge ${lead.status === 'completed' ? 'badge-success' : 'badge-info'}`}>
                      {lead.status}
                    </span>
                    {lead.reassign_requested && (
                      <span className="badge badge-warning">Reassign pending</span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-sm mb-1">
                    <div>
                      <p className="text-gray-500">Email</p>
                      <p className="font-medium text-gray-900 break-all">{lead.email || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Contact</p>
                      <p className="font-medium text-gray-900">{lead.phone || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Preferred language</p>
                      <p className="font-medium text-gray-900">{lead.preferred_language || '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Assigned</p>
                      <p className="font-medium text-gray-900">{formatDate(lead.assigned_at)}</p>
                    </div>
                  </div>

                  {callLangs(lead).length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 mb-1">Call language</p>
                      <div className="flex flex-wrap gap-1">
                        {callLangs(lead).map((lang) => (
                          <span key={lang} className="badge badge-warning">{lang}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {lead.reassign_requested ? (
                    <div className="mt-3 p-2 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900 flex gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        Reassign requested
                        {lead.reassign_reason ? `: ${lead.reassign_reason}` : ''}
                        {' — waiting for admin'}
                      </span>
                    </div>
                  ) : lead.status !== 'completed' && (
                    <div className="mt-3 p-3 rounded border border-gray-200 bg-gray-50">
                      <p className="text-xs font-medium text-gray-700 mb-1">Request reassign</p>
                      <textarea
                        className="input-field text-sm min-h-[64px]"
                        placeholder="Reason (language mismatch, need help, etc.)"
                        value={reassignReason[lead.id] || ''}
                        onChange={(e) =>
                          setReassignReason((prev) => ({ ...prev, [lead.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        onClick={() => handleRequestReassign(lead.id)}
                        disabled={reassignId === lead.id}
                        className="btn-secondary text-xs mt-2 inline-flex items-center gap-1"
                      >
                        {reassignId === lead.id ? <Spinner /> : null}
                        Request reassign
                      </button>
                    </div>
                  )}

                  <CallSchedulePanel
                    leadId={lead.id}
                    leadName={lead.name || lead.lead_name}
                    onInsightsReady={handleInsightsReady}
                    showAiInsights={false}
                  />
                </div>

                {lead.status !== 'completed' && (
                  <button
                    onClick={() => handleCompleteLead(lead.id)}
                    disabled={completingId === lead.id}
                    className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto sm:ml-4 flex-shrink-0"
                  >
                    {completingId === lead.id ? (
                      <>
                        <Spinner />
                        Completing...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Complete
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="card overflow-hidden p-0">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default BDLeads;
