import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { 
  FileText, 
  AlertTriangle, 
  RefreshCw, 
  UserX,
  TrendingUp,
  Clock
} from 'lucide-react';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [recentHistory, setRecentHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [statsRes, historyRes] = await Promise.all([
        dashboardAPI.getStats(),
        dashboardAPI.getRoutingHistory()
      ]);
      
      setStats(statsRes.data);
      setRecentHistory(historyRes.data.slice(0, 5));
    } catch (error) {
      toast.error('Failed to load dashboard data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getBadgeClass = (type) => {
    const classes = {
      'automatic': 'badge-success',
      'manual': 'badge-info',
      'manual-review': 'badge-warning'
    };
    return classes[type] || 'badge-gray';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">Lead routing overview and recent activity</p>
        </div>
        <button onClick={fetchDashboardData} className="btn-primary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card hover:shadow-lg transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Leads</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.total_leads || 0}</p>
            </div>
          </div>
        </div>

        <div className="card hover:shadow-lg transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-100 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Language Mismatches</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.language_mismatches || 0}</p>
            </div>
          </div>
        </div>

        <div className="card hover:shadow-lg transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Auto-Routed</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.automatically_routed || 0}</p>
            </div>
          </div>
        </div>

        <div className="card hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/unassigned')}>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-orange-100 rounded-lg">
              <UserX className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Unassigned Leads</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.unassigned_leads || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Routing Activity */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Routing Activity</h2>
          <button 
            onClick={() => navigate('/history')}
            className="text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            View All
          </button>
        </div>

        {recentHistory.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No recent routing activity</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Lead</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Previous BD</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">New BD</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Reason</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentHistory.map((event) => (
                  <tr key={event.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm text-gray-900">{event.lead_name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{event.previous_bd_name || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-900">{event.new_bd_name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600 max-w-xs truncate" title={event.reason}>
                      {event.reason}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${getBadgeClass(event.routing_type)}`}>
                        {event.routing_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500">{formatDate(event.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
