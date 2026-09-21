import React, { useState, useEffect, useCallback } from 'react';
import { dashboardAPI, bdsAPI } from '../../services/api';
import { FileText, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageLoader } from '../../components/Spinner';
import Pagination from '../../components/Pagination';
import { getErrorMessage } from '../../utils/errors';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBD, setSelectedBD] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchStats = async () => {
    const statsRes = await dashboardAPI.getStats();
    setStats(statsRes.data);
  };

  const fetchBDs = useCallback(async () => {
    const bdsRes = await bdsAPI.getAll({ page, page_size: pageSize });
    const data = bdsRes.data || {};
    setBds(data.items || []);
    setTotal(data.total || 0);
    setTotalPages(data.total_pages || 0);
  }, [page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([fetchStats(), fetchBDs()]);
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, 'Failed to load dashboard'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchBDs]);

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">Overview of BD team workload and lead routing</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total BDs</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.total_bds || 0}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Leads</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.total_leads || 0}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-orange-100 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Pending Leads</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.pending_leads || 0}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Completed</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.completed_leads || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <h2 className="text-lg font-semibold text-gray-900 px-4 sm:px-6 pt-4 sm:pt-6 mb-4">
          BD Workload Overview
        </h2>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">BD Name</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Supported Languages</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Active Leads</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Capacity</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {bds.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-gray-500">No BDs found</td>
                </tr>
              ) : (
                bds.map((bd) => (
                  <tr key={bd.bd_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{bd.name}</div>
                      <div className="text-xs text-gray-500">{bd.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(bd.supported_languages || []).map((lang) => (
                          <span key={lang} className="badge badge-info">{lang}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`badge ${bd.active_lead_count >= 3 ? 'badge-danger' : 'badge-success'}`}>
                        {bd.active_lead_count} / 3
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-gray-600">{bd.available_capacity}</td>
                    <td className="py-3 px-4">
                      <span className={`badge ${bd.availability_status === 'Full' ? 'badge-danger' : 'badge-success'}`}>
                        {bd.availability_status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => setSelectedBD(bd)}
                        className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                      >
                        View Details
                      </button>
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
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      {selectedBD && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{selectedBD.name}</h2>
                <p className="text-sm text-gray-500 break-words">{selectedBD.email} • {selectedBD.phone}</p>
              </div>
              <button
                onClick={() => setSelectedBD(null)}
                className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Supported Languages</p>
                <div className="flex flex-wrap gap-2">
                  {(selectedBD.supported_languages || []).map((lang) => (
                    <span key={lang} className="badge badge-info">{lang}</span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Active Leads</p>
                  <p className="text-2xl font-bold text-gray-900">{selectedBD.active_lead_count}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Available Capacity</p>
                  <p className="text-2xl font-bold text-gray-900">{selectedBD.available_capacity}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Assigned Leads</p>
                {selectedBD.assigned_leads?.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No active leads currently assigned</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table min-w-[480px]">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Lead Name</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Email</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Language</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBD.assigned_leads?.map((lead) => (
                          <tr key={lead.id} className="border-b border-gray-100">
                            <td className="py-2 px-3 text-sm">{lead.lead_name || lead.name}</td>
                            <td className="py-2 px-3 text-sm text-gray-600">{lead.email || lead.phone || '-'}</td>
                            <td className="py-2 px-3">
                              <span className="badge badge-info">{lead.preferred_language}</span>
                            </td>
                            <td className="py-2 px-3">
                              <span className="badge badge-success">{lead.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
