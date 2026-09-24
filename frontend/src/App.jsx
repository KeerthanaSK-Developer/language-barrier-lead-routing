import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import AdminLeads from './pages/admin/Leads';
import AdminPending from './pages/admin/Pending';
import AiHowItWorks from './pages/admin/AiHowItWorks';
import CreateUsers from './pages/CreateUsers';
import ResetPassword from './pages/ResetPassword';
import BDLeads from './pages/bd/Leads';
import AdminLayout from './layouts/AdminLayout';
import BDLayout from './layouts/BDLayout';
import { PageLoader } from './components/Spinner';

const ProtectedRoute = ({ children, role }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageLoader className="h-auto" />
      </div>
    );
  }
  
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin/dashboard' : '/bd/leads'} replace />;
  }
  
  return children;
};

const RoleLayout = ({ children }) => {
  const { user } = useAuth();
  if (user?.role === 'bd') {
    return <BDLayout>{children}</BDLayout>;
  }
  return <AdminLayout>{children}</AdminLayout>;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { background: '#363636', color: '#fff' }
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          
          {/* Admin Routes */}
          <Route path="/admin/dashboard" element={
            <ProtectedRoute role="admin">
              <AdminLayout><AdminDashboard /></AdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/admin/leads" element={
            <ProtectedRoute role="admin">
              <AdminLayout><AdminLeads /></AdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/admin/bds" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/pending" element={
            <ProtectedRoute role="admin">
              <AdminLayout><AdminPending /></AdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/admin/ai-insights" element={
            <ProtectedRoute role="admin">
              <AdminLayout><AiHowItWorks /></AdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/admin/users" element={
            <ProtectedRoute role="admin">
              <AdminLayout><CreateUsers /></AdminLayout>
            </ProtectedRoute>
          } />
          <Route path="/reset-password" element={
            <ProtectedRoute>
              <RoleLayout><ResetPassword /></RoleLayout>
            </ProtectedRoute>
          } />
          
          {/* BD Routes */}
          <Route path="/bd/leads" element={
            <ProtectedRoute role="bd">
              <BDLayout><BDLeads /></BDLayout>
            </ProtectedRoute>
          } />
          
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
