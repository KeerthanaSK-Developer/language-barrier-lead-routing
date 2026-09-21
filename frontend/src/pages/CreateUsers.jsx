import React, { useState } from 'react';
import { authAPI } from '../services/api';
import BulkCsvUpload from '../components/BulkCsvUpload';
import { Spinner } from '../components/Spinner';
import { getErrorMessage } from '../utils/errors';
import { UserPlus, Upload, Mail, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const CreateUsers = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'bd',
    supported_languages: []
  });
  const [languages, setLanguages] = useState([]);
  const [showOther, setShowOther] = useState(false);
  const [otherLanguage, setOtherLanguage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const availableLanguages = ['English', 'Tamil', 'Hindi', 'Telugu', 'Spanish', 'French', 'German', 'Kannada', 'Malayalam'];

  const resetForm = () => {
    setFormData({ name: '', email: '', phone: '', role: 'bd', supported_languages: [] });
    setLanguages([]);
    setShowOther(false);
    setOtherLanguage('');
    setFormError('');
  };

  const setLanguagesAndForm = (updated) => {
    setLanguages(updated);
    setFormData((prev) => ({ ...prev, supported_languages: updated }));
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setFormError('');
    // If Other input has text but wasn't added yet, include it
    let langs = [...languages];
    const pending = otherLanguage.trim();
    if (showOther && pending) {
      const exists = langs.some((l) => l.toLowerCase() === pending.toLowerCase());
      if (!exists) langs = [...langs, pending];
    }
    if (formData.role === 'bd' && langs.length === 0) {
      setFormError('BD users require at least one supported language');
      return;
    }
    try {
      setSubmitting(true);
      const payload = { ...formData, supported_languages: langs };
      const response = await authAPI.createUser(payload);
      const assigned = response.data.assigned_leads_count || 0;
      if (formData.role === 'bd' && assigned > 0) {
        toast.success(`User created! ${assigned} matching pending lead(s) assigned. Credentials sent to ${formData.email}`);
      } else {
        toast.success(`User created! Credentials sent to ${formData.email}`);
      }
      setShowCreateModal(false);
      resetForm();
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to create user');
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const processUserRow = async (row) => {
    const [name, email, phone, role, langsRaw = ''] = row;
    const roleNorm = (role || '').trim().toLowerCase();
    const supported_languages = String(langsRaw)
      .split(/[|;]/)
      .map((l) => l.trim())
      .filter(Boolean);

    const payload = {
      name: (name || '').trim(),
      email: (email || '').trim(),
      phone: (phone || '').trim(),
      role: roleNorm,
      supported_languages: roleNorm === 'bd' ? supported_languages : [],
    };

    await authAPI.createUser(payload);
    return {
      reason: 'Created successfully',
      data: {
        ...payload,
        supported_languages: supported_languages.join('|'),
      },
    };
  };

  const toggleLanguage = (lang) => {
    const updated = languages.includes(lang)
      ? languages.filter((l) => l !== lang)
      : [...languages, lang];
    setLanguagesAndForm(updated);
  };

  const customLanguages = languages.filter((l) => !availableLanguages.includes(l));

  const addOtherLanguage = () => {
    const value = otherLanguage.trim();
    if (!value) {
      toast.error('Enter a language name');
      return;
    }
    const exists = languages.some((l) => l.toLowerCase() === value.toLowerCase());
    if (exists) {
      toast.error('Language already selected');
      return;
    }
    setLanguagesAndForm([...languages, value]);
    setOtherLanguage('');
  };

  const removeCustomLanguage = (lang) => {
    setLanguagesAndForm(languages.filter((l) => l !== lang));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          Create Admin and BD users - passwords auto-generated and sent via email
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        <div className="card hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setShowCreateModal(true)}>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-lg flex-shrink-0">
              <UserPlus className="w-8 h-8 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">Create Single User</h3>
              <p className="text-sm text-gray-500">Add one Admin or BD user</p>
            </div>
          </div>
        </div>

        <div className="card hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setShowBulkModal(true)}>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-lg flex-shrink-0">
              <Upload className="w-8 h-8 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">Bulk Upload Users</h3>
              <p className="text-sm text-gray-500">Upload multiple users via CSV</p>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-md w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            <h2 className="text-xl font-semibold mb-4">Create New User</h2>
            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <span className="text-red-700 text-sm">{formError}</span>
              </div>
            )}
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="input-field"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="input-field"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone *</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="input-field"
                  placeholder="10 digit number"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                  className="input-field"
                >
                  <option value="bd">BD (Business Development)</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              {formData.role === 'bd' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Supported Languages *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availableLanguages.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleLanguage(lang)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          languages.includes(lang)
                            ? 'bg-primary-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowOther((v) => !v)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        showOther || customLanguages.length > 0
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Other
                    </button>
                  </div>
                  {showOther && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={otherLanguage}
                          onChange={(e) => setOtherLanguage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addOtherLanguage();
                            }
                          }}
                          className="input-field flex-1"
                          placeholder="Type any language (e.g. Japanese, Mandarin)"
                        />
                        <button type="button" onClick={addOtherLanguage} className="btn-secondary whitespace-nowrap">
                          Add
                        </button>
                      </div>
                      {customLanguages.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {customLanguages.map((lang) => (
                            <button
                              key={lang}
                              type="button"
                              onClick={() => removeCustomLanguage(lang)}
                              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700"
                              title="Click to remove"
                            >
                              {lang} ×
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">Password Auto-Generated</span>
                </div>
                <p className="text-xs text-blue-700">System will generate and email credentials automatically</p>
              </div>
              
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="btn-secondary flex-1"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Spinner />
                      Creating...
                    </>
                  ) : (
                    'Create User'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkModal && (
        <BulkCsvUpload
          title="Bulk Upload Users"
          columns={[
            { key: 'name', label: 'name' },
            { key: 'email', label: 'email' },
            { key: 'phone', label: 'phone' },
            { key: 'role', label: 'role (admin|bd)' },
            { key: 'supported_languages', label: 'supported_languages (use | )' },
          ]}
          exampleRows={[
            ['Arun Kumar', 'arun@company.com', '9876543210', 'bd', 'Tamil|English'],
            ['Admin User', 'admin2@company.com', '9876543211', 'admin', ''],
          ]}
          processRow={processUserRow}
          resultColumns={[
            { key: 'row', label: 'row' },
            { key: 'name', label: 'name' },
            { key: 'email', label: 'email' },
            { key: 'phone', label: 'phone' },
            { key: 'role', label: 'role' },
            { key: 'supported_languages', label: 'supported_languages' },
            { key: 'status', label: 'status' },
            { key: 'reason', label: 'reason' },
          ]}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
};

export default CreateUsers;
