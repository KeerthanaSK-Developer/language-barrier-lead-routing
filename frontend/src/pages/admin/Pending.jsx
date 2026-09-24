import React, { useState, useEffect, useCallback } from 'react';
import { dashboardAPI, bdsAPI, leadsAPI } from '../../services/api';
import { AlertTriangle, Clock, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageLoader } from '../../components/Spinner';
import Pagination from '../../components/Pagination';
import BdAssignPicker from '../../components/BdAssignPicker';
import { getErrorMessage } from '../../utils/errors';

const AdminPending = () => {
  const [pendingLeads, setPendingLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openAssignId, setOpenAssignId] = useState(null);
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

  const handleAssign = async (leadId, bdId) => {
    try {
      setAssigningTo(leadId);
      const res = await leadsAPI.manualAssign(leadId, bdId);
      if (res.data.warning) {
        toast.success(`Assigned (note: ${res.data.warning})`);
      } else {
        toast.success(res.data.message || 'Lead assigned');
      }
      setOpenAssignId(null);
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
          Leads awaiting manual assignment — same-language BDAs listed first, then other free slots
        </p>
      </div>

      {total > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-orange-900">Attention Required</h3>
            <p className="text-sm text-orange-700 mt-1">
              {total} lead(s) pending. Assign manually — no automatic routing.
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
            const pickerLead = { ...lead, id: leadId };

            return (
              <div key={leadId} className="card border-l-4 border-orange-400">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-semibold text-gray-900">{lead.name || lead.lead_name}</h3>
                    <span className="badge badge-warning">Pending</span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {lead.email || ''}{lead.phone ? ` · ${lead.phone}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-gray-400" />
                      <span>
                        Preferred:{' '}
                        <span className="badge badge-info">{lead.preferred_language || '—'}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-500">Created: {formatDate(lead.created_at)}</span>
                    </div>
                  </div>

                  {openAssignId === leadId ? (
                    <BdAssignPicker
                      lead={pickerLead}
                      bds={bds}
                      mode="assign"
                      busy={assigningTo === leadId}
                      onConfirm={(bdId) => handleAssign(leadId, bdId)}
                      onCancel={() => setOpenAssignId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="btn-primary text-sm w-full sm:w-auto"
                      onClick={() => setOpenAssignId(leadId)}
                    >
                      Assign
                    </button>
                  )}
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
