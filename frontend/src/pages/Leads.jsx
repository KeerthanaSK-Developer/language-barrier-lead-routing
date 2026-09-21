import React, { useState, useEffect } from 'react';
import { leadsAPI, bdsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  RefreshCw,
  Globe,
  Building,
  User,
  AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

const Leads = () => {
  const [leads, setLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const { isAdmin } = useAuth();

  const [formData, setFormData] = useState({
    lead_name: '',
    company: '',
    country: '',
    preferred_language: '',
    assigned_bd: ''
  });

  const languages = ['English', 'Tamil', 'Hindi', 'Telugu', 'Spanish', 'French', 'German', 'Kannada', 'Malayalam'];
  const statuses = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed'];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [leadsRes, bdsRes] = await Promise.all([
        leadsAPI.getAll(),
        bdsAPI.getAll()
      ]);
      setLeads(leadsRes.data);
      setBds(bdsRes.data);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (lead = null) => {
    if (lead) {
      setEditingLead(lead);
      setFormData({
        lead_name: lead.lead_name,
        company: lead.company,
        country: lead.country,
        preferred_language: lead.preferred_language,
        assigned_bd: lead.assigned_bd || ''
      });
    } else {
      setEditingLead(null);
      setFormData({
        lead_name: '',
        company: '',
        country: '',
        preferred_language: '',
        assigned_bd: ''
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingLead) {
        const response = await leadsAPI.update(editingLead.id, formData);
        toast.success('Lead updated successfully');
        
        if (response.data.routing?.routed) {
          toast.success(`Auto-routed to ${response.data.routing.new_bd}`, {
            icon: '🔄',
            duration: 5000
          });
        }
      } else {
        const response = await leadsAPI.create(formData);
        toast.success('Lead created successfully');
        
        if (response.data.routing?.routed) {
          toast.success(`Auto-routed to ${response.data.routing.new_bd}`, {
            icon: '🔄',
            duration: 5000
          });
        } else if (response.data.routing?.routing_type === 'manual-review') {
          toast.error('No BD available for this language - marked for manual review', {
            icon: '⚠️',
            duration: 5000
          });
        }
      }
      
      setShowModal(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDelete = async (leadId) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return;
    
    try {
      await leadsAPI.delete(leadId);
      toast.success('Lead deleted successfully');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete lead');
    }
  };

  const getRoutingStatusBadge = (status) => {
    const statusClasses = {
      'pending': 'badge-warning',
      'auto-routed': 'badge-success',
      'manually-assigned': 'badge-info',
      'manual-review': 'badge-danger'
    };
    return statusClasses[status] || 'badge-gray';
  };

  const getStatusBadge = (status) => {
    const statusClasses = {
      'new': 'badge-info',
      'contacted': 'badge-warning',
      'qualified': 'badge-success',
      'proposal': 'badge-info',
      'negotiation': 'badge-warning',
      'closed': 'badge-success'
    };
    return statusClasses[status] || 'badge-gray';
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = 
      lead.lead_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.country.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = filterStatus === 'all' || lead.routing_status === filterStatus;
    
    return matchesSearch && matchesFilter;
  });

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 mt-1">Manage and route business development leads</p>
        </div>
        {isAdmin() && (
          <button 
            onClick={() => handleOpenModal()}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Lead
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search leads by name, company, or country..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 input-field"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-gray-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="auto-routed">Auto-Routed</option>
              <option value="manually-assigned">Manually Assigned</option>
              <option value="manual-review">Manual Review</option>
            </select>
          </div>
          <button onClick={fetchData} className="btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Leads Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Lead Name
                  </div>
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Company
                  </div>
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Country</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Language
                  </div>
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Assigned BD</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Routing Status</th>
                {isAdmin() && <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin() ? 8 : 7} className="py-8 text-center text-gray-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No leads found</p>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{lead.lead_name}</div>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{lead.company}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{lead.country}</td>
                    <td className="py-3 px-4">
                      <span className="badge badge-info">{lead.preferred_language}</span>
                    </td>
                    <td className="py-3 px-4">
                      {lead.assigned_bd_name || (
                        <span className="text-gray-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${getStatusBadge(lead.status)}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${getRoutingStatusBadge(lead.routing_status)}`}>
                        {lead.routing_status}
                      </span>
                    </td>
                    {isAdmin() && (
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleOpenModal(lead)}
                            className="p-1 text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(lead.id)}
                            className="p-1 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingLead ? 'Edit Lead' : 'Add New Lead'}
              </h2>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lead Name *
                </label>
                <input
                  type="text"
                  value={formData.lead_name}
                  onChange={(e) => setFormData({...formData, lead_name: e.target.value})}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Company *
                </label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({...formData, company: e.target.value})}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Country *
                </label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) => setFormData({...formData, country: e.target.value})}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Language *
                </label>
                <select
                  value={formData.preferred_language}
                  onChange={(e) => setFormData({...formData, preferred_language: e.target.value})}
                  className="input-field"
                  required
                >
                  <option value="">Select Language</option>
                  {languages.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assigned BD (Optional)
                </label>
                <select
                  value={formData.assigned_bd}
                  onChange={(e) => setFormData({...formData, assigned_bd: e.target.value})}
                  className="input-field"
                >
                  <option value="">Auto-assign based on language</option>
                  {bds.map(bd => (
                    <option key={bd.bd_id} value={bd.bd_id}>
                      {bd.name} ({bd.supported_languages.join(', ')})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  {editingLead ? 'Update Lead' : 'Create Lead'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Leads;
