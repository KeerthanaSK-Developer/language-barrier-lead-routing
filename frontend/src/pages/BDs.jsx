import React, { useState, useEffect } from 'react';
import { bdsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { 
  Plus, 
  RefreshCw, 
  Edit2, 
  Trash2,
  Users,
  Globe,
  CheckCircle,
  XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

const BDs = () => {
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBd, setEditingBd] = useState(null);
  const { isAdmin } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    supported_languages: [],
    availability: true
  });

  const languages = ['English', 'Tamil', 'Hindi', 'Telugu', 'Spanish', 'French', 'German', 'Kannada', 'Malayalam'];

  useEffect(() => {
    fetchBDs();
  }, []);

  const fetchBDs = async () => {
    try {
      setLoading(true);
      const response = await bdsAPI.getAll();
      setBds(response.data);
    } catch (error) {
      toast.error('Failed to load BDs');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (bd = null) => {
    if (bd) {
      setEditingBd(bd);
      setFormData({
        name: bd.name,
        supported_languages: bd.supported_languages,
        availability: bd.availability
      });
    } else {
      setEditingBd(null);
      setFormData({
        name: '',
        supported_languages: [],
        availability: true
      });
    }
    setShowModal(true);
  };

  const handleLanguageToggle = (lang) => {
    const updated = formData.supported_languages.includes(lang)
      ? formData.supported_languages.filter(l => l !== lang)
      : [...formData.supported_languages, lang];
    setFormData({...formData, supported_languages: updated});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (formData.supported_languages.length === 0) {
      toast.error('Please select at least one language');
      return;
    }
    
    try {
      if (editingBd) {
        await bdsAPI.update(editingBd.bd_id, formData);
        toast.success('BD updated successfully');
      } else {
        await bdsAPI.create(formData);
        toast.success('BD created successfully');
      }
      
      setShowModal(false);
      fetchBDs();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDelete = async (bdId) => {
    if (!window.confirm('Are you sure you want to delete this BD?')) return;
    
    try {
      await bdsAPI.delete(bdId);
      toast.success('BD deleted successfully');
      fetchBDs();
    } catch (error) {
      toast.error('Failed to delete BD');
    }
  };

  const handleToggleAvailability = async (bd) => {
    try {
      await bdsAPI.update(bd.bd_id, {
        availability: !bd.availability
      });
      toast.success(`BD ${bd.name} is now ${!bd.availability ? 'available' : 'unavailable'}`);
      fetchBDs();
    } catch (error) {
      toast.error('Failed to update availability');
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BD Team</h1>
          <p className="text-gray-500 mt-1">Manage business development representatives</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchBDs} className="btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {isAdmin() && (
            <button 
              onClick={() => handleOpenModal()}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add BD
            </button>
          )}
        </div>
      </div>

      {/* BD Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bds.map((bd) => (
          <div key={bd.bd_id} className="card hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{bd.name}</h3>
                  <span className={`badge ${bd.availability ? 'badge-success' : 'badge-danger'}`}>
                    {bd.availability ? 'Available' : 'Unavailable'}
                  </span>
                </div>
              </div>
              {isAdmin() && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenModal(bd)}
                    className="p-1 text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(bd.bd_id)}
                    className="p-1 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Languages */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-600">Supported Languages</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {bd.supported_languages.map((lang) => (
                  <span key={lang} className="badge badge-info">
                    {lang}
                  </span>
                ))}
              </div>
            </div>

            {/* Lead Count */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div>
                <p className="text-sm text-gray-500">Current Leads</p>
                <p className="text-2xl font-bold text-gray-900">{bd.current_lead_count}</p>
              </div>
              {isAdmin() && (
                <button
                  onClick={() => handleToggleAvailability(bd)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    bd.availability
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {bd.availability ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Active
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4" />
                      Inactive
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingBd ? 'Edit BD' : 'Add New BD'}
              </h2>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  BD Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Supported Languages *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {languages.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => handleLanguageToggle(lang)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        formData.supported_languages.includes(lang)
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.availability}
                    onChange={(e) => setFormData({...formData, availability: e.target.checked})}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Available for Assignment</span>
                </label>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button type="submit" className="btn-primary flex-1">
                  {editingBd ? 'Update BD' : 'Create BD'}
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

export default BDs;
