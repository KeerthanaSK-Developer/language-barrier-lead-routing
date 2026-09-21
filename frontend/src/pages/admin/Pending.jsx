import React, { useState, useEffect, useCallback } from 'react';
import { dashboardAPI, bdsAPI, leadsAPI } from '../../services/api';
import { AlertTriangle, Clock, Globe, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Spinner, PageLoader } from '../../components/Spinner';
import Pagination from '../../components/Pagination';
import { getErrorMessage } from '../../utils/errors';

const AdminPending = () => {
  const [pendingLeads, setPendingLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBd, setSelectedBd] = useState({});
  const [assigningTo, setAssigningTo] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [pendingRes, bdsRes] = await Promise.all([
        dashboardAPI.getPendingLeads({ page, page_size: pageSize }),
        bdsAPI.getAll({ page: 1, page_size: 100 }),
      ]);
      const data = pendingRes.data || {};
      setPendingLeads(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 0);
      const bdItems = bdsRes.data?.items || [];
      setBds(bdItems.filter((bd) => bd.status !== 'inactive'));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load pending leads'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const matchingBDs = (language) =>
    bds.filter((bd) =>
      (bd.supported_languages || []).some(
        (l) => String(l).toLowerCase() === String(language || '').toLowerCase()
      )
    );

  const handleAssign = async (leadId) => {
    const bdId = selectedBd[leadId];
    if (!bdId) {
      toast.error('Please select a BD');
      return;
    }
    try {
      setAssigningTo(leadId);
      const res = await leadsAPI.manualAssign(leadId, bdId);
      if (res.data.warning) {
        toast.success(`Assigned (note: ${res.data.warning})`);
      } else {
        toast.success(res.data.message || 'Lead assigned');
      }
      setSelectedBd((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      await fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to assign lead'));
    } finally {
      setAssigningTo(null);
    }
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Pending Leads</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          Leads awaiting assignment — auto-route when capacity opens, or assign manually anytime
        </p>
      </div>

      {total > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-orange-900">Attention Required</h3>
            <p className="text-sm text-orange-700 mt-1">
              {total} lead(s) pending. You can manually assign them to any BD below
              (even if language does not match).
            </p>
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <p className="text-gray-500 text-lg">No pending leads!</p>
          <p className="text-gray-400 text-sm mt-2">All leads have been assigned to BDs</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingLeads.map((lead) => {
            const leadId = lead.lead_id || lead.id;
            const matches = matchingBDs(lead.preferred_language);

            return (
              <div key={leadId} className="card border-l-4 border-orange-400">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">{lead.name || lead.lead_name}</h3>
                      <span className="badge badge-warning">Pending</span>
                    </div>

                    <p className="text-sm text-gray-600 mb-2">
                      {lead.email || ''}{lead.phone ? ` · ${lead.phone}` : ''}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-gray-400" />
                        <span>Language: <span className="badge badge-info">{lead.preferred_language}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-500">Created: {formatDate(lead.created_at)}</span>
                      </div>
                    </div>

                    {matches.length === 0 ? (
                      <p className="text-sm text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        No BD speaks <strong>{lead.preferred_language}</strong>. You can still assign manually to any BD.
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 mt-3">
                        Matching BDs: {matches.map((b) => b.name).join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 w-full lg:w-auto lg:min-w-[280px]">
                    <select
                      value={selectedBd[leadId] || ''}
                      onChange={(e) => setSelectedBd({ ...selectedBd, [leadId]: e.target.value })}
                      className="input-field w-full"
                    >
                      <option value="">Select BD</option>
                      {bds.map((bd) => {
                        const speaks = (bd.supported_languages || []).some(
                          (l) => String(l).toLowerCase() === String(lead.preferred_language || '').toLowerCase()
                        );
                        const capacity = bd.available_capacity ?? Math.max(0, 3 - (bd.active_lead_count || 0));
                        return (
                          <option key={bd.bd_id} value={bd.bd_id} disabled={capacity <= 0}>
                            {bd.name}
                            {speaks ? ' ✓ lang' : ''}
                            {` · ${capacity} slots`}
                            {capacity <= 0 ? ' (full)' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      onClick={() => handleAssign(leadId)}
                      disabled={!selectedBd[leadId] || assigningTo === leadId}
                      className="btn-primary flex items-center justify-center gap-2 w-full"
                    >
                      {assigningTo === leadId ? (
                        <>
                          <Spinner />
                          Assigning...
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4" />
                          Assign
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

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

export default AdminPending;
