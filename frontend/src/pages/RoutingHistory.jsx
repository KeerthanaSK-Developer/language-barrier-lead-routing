import React, { useState, useEffect } from 'react';
import { dashboardAPI } from '../services/api';
import { Clock, ArrowRight, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const RoutingHistory = () => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await dashboardAPI.getRoutingHistory();
      setHistory(response.data);
    } catch (error) {
      toast.error('Failed to load routing history');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getRoutingTypeBadge = (type) => {
    const classes = {
      'automatic': 'badge-success',
      'manual': 'badge-info'
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Routing History</h1>
        <p className="text-gray-500 mt-1">Track all automatic and manual lead routing events</p>
      </div>

      {/* History Timeline */}
      <div className="space-y-4">
        {history.length === 0 ? (
          <div className="card text-center py-12">
            <Clock className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500 text-lg">No routing history yet</p>
            <p className="text-gray-400 text-sm mt-2">Routing events will appear here when leads are assigned</p>
          </div>
        ) : (
          history.map((event, index) => (
            <div key={event.id} className="card border-l-4 border-primary-500">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-gray-900">{event.lead_name}</h3>
                    <span className={`badge ${getRoutingTypeBadge(event.routing_type)}`}>
                      {event.routing_type}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm">
                    {event.previous_bd_name ? (
                      <>
                        <span className="text-gray-600">{event.previous_bd_name}</span>
                        <ArrowRight className="w-4 h-4 text-primary-600" />
                        <span className="font-medium text-gray-900">{event.new_bd_name}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-gray-400 italic">Unassigned</span>
                        <ArrowRight className="w-4 h-4 text-primary-600" />
                        <span className="font-medium text-gray-900">{event.new_bd_name}</span>
                      </>
                    )}
                  </div>
                  
                  <p className="text-sm text-gray-600 mt-2 italic">"{event.reason}"</p>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock className="w-4 h-4" />
                  {formatDate(event.timestamp)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RoutingHistory;
