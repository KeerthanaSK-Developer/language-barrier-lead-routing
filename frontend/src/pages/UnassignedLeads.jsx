import React, { useState, useEffect } from 'react';
import { dashboardAPI, bdsAPI, leadsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, UserPlus, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

const UnassignedLeads = () => {
  const [unassignedLeads, setUnassignedLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigningTo, setAssigningTo] = useState(null);
  const [selectedBd, setSelectedBd] = useState({});
  const { isAdmin } = useAuth();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [leadsRes, bdsRes] = await Promise.all([
        dashboardAPI.getUnassignedLeads(),
        bdsAPI.getAll()
      ]);
      setUnassignedLeads(leadsRes.data);
      setBds(bdsRes.data.filter(bd => bd.availability));
    } catch (error) {
      toast.error('Failed to load unassigned leads');
    } finally {
      setLoading(false);
    }
  };

  const handleManualAssign = async (leadId, bdId) => {
    if (!bdId) {
      toast.error('Please select a BD to assign');
      return;
    }

    try {
      setAssigningTo(leadId);
      await leadsAPI.manualAssign(leadId, bdId);
      toast.success('Lead assigned successfully');
      fetchData();
    } catch (error) {
      toast.error('Failed to assign lead');
    } finally {
      setAssigningTo(null);
    }
  };

  const getLanguageMatchingBDs = (language) => {
    return bds.filter(bd => bd.supported_languages.includes(language));
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
        <h1 className="text-2xl font-bold text-gray-900">Unassigned Leads</h1>
        <p className="text-gray-500 mt-1">Leads requiring manual assignment - no BD matches available</p>
      </div>

      {/* Alert Banner */}
      {unassignedLeads.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-orange-900">Attention Required</h3>
            <p className="text-sm text-orange-700 mt-1">
              {unassignedLeads.length} lead(s) could not be automatically routed due to language compatibility. 
              Please review and manually assign them.
            </p>
          </div>
        </div>
      )}

      {/* Unassigned Leads List */}
      {unassignedLeads.length === 0 ? (
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-gray-500 text-lg">All leads are assigned!</p>
          <p className="text-gray-400 text-sm mt-2">There are no unassigned leads at the moment</p>
        </div>
      ) : (
        <div className="space-y-4">
          {unassignedLeads.map((lead) => {
            const matchingBDs = getLanguageMatchingBDs(lead.preferred_language);
            
            return (
              <div key={lead.id} className="card border-l-4 border-orange-400">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">{lead.lead_name}</h3>
                      <span className="badge badge-warning">{lead.routing_status}</span>
                    </div>
                    
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                      <span>
                        <strong>Company:</strong> {lead.company}
                      </span>
                      <span>
                        <strong>Country:</strong> {lead.country}
                      </span>
                      <span>
                        <strong>Language:</strong>{' '}
                        <span className="badge badge-info">{lead.preferred_language}</span>
                      </span>
                    </div>

                    {matchingBDs.length === 0 && (
                      <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <p className="text-sm text-yellow-800">
                          ⚠️ No BD currently supports <strong>{lead.preferred_language}</strong>. 
                          Consider adding this language to a BD or assign to any available BD.
                        </p>
                      </div>
                    )}

                    {matchingBDs.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm text-gray-600 mb-2">
                          💡 BDs who speak {lead.preferred_language}:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {matchingBDs.map(bd => (
                            <span key={bd.bd_id} className="badge badge-success">
                              {bd.name} ({bd.current_lead_count} leads)
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {isAdmin() && (
                    <div className="flex items-center gap-3">
                      <select
                        value={selectedBd[lead.id] || ''}
                        onChange={(e) => setSelectedBd({...selectedBd, [lead.id]: e.target.value})}
                        className="input-field w-48"
                      >
                        <option value="">Select BD</option>
                        {bds.map(bd => (
                          <option key={bd.bd_id} value={bd.bd_id}>
                            {bd.name} ({bd.supported_languages.slice(0, 2).join(', ')})
                          </option>
                        ))}
                      </select>
                      
                      <button
                        onClick={() => handleManualAssign(lead.id, selectedBd[lead.id])}
                        disabled={!selectedBd[lead.id] || assigningTo === lead.id}
                        className="btn-primary flex items-center gap-2"
                      >
                        {assigningTo === lead.id ? (
                          'Assigning...'
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4" />
                            Assign
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UnassignedLeads;
