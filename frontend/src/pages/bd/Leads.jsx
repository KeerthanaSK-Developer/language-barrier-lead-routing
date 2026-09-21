import React, { useState, useEffect, useCallback } from 'react';
import { leadsAPI } from '../../services/api';
import { FileText, CheckCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { Spinner, PageLoader } from '../../components/Spinner';
import Pagination from '../../components/Pagination';
import { getErrorMessage } from '../../utils/errors';

const BDLeads = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState(null);
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

  useEffect(() => {
    setLoading(true);
    fetchMyLeads();
  }, [fetchMyLeads]);

  const handleCompleteLead = async (leadId) => {
    try {
      setCompletingId(leadId);
      const response = await leadsAPI.complete(leadId);
      const reclaimed = response.data.reclaimed || [];
      const assigned = response.data.assigned_leads || [];

      if (reclaimed.length > 0) {
        const names = reclaimed.map((r) => r.lead_name).join(', ');
        toast.success(`Lead completed! Reclaimed language-matched lead(s): ${names}`);
      } else if (response.data.automatically_assigned) {
        toast.success(`Lead completed! ${assigned.length} pending lead(s) auto-assigned to you.`);
      } else {
        toast.success('Lead marked as completed');
      }

      await fetchMyLeads();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to complete lead'));
    } finally {
      setCompletingId(null);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Leads</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          Manage your assigned leads and mark them as completed
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <Clock className="w-5 h-5 text-blue-600 mt-0.5" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-900">Automatic Assignment</p>
            <p className="text-sm text-blue-700 mt-1">
              When you complete a lead, the system fills your free slot with pending leads,
              then reclaims matching-language leads that were manually given to BDs who do not speak that language.
            </p>
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="card text-center py-12">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 text-lg">No active leads assigned</p>
          <p className="text-gray-400 text-sm mt-2">You'll be automatically notified when a new lead is assigned</p>
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
                      <p className="text-gray-500">Language</p>
                      <p className="font-medium text-gray-900">{lead.preferred_language}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Assigned</p>
                      <p className="font-medium text-gray-900">{formatDate(lead.assigned_at)}</p>
                    </div>
                  </div>
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
