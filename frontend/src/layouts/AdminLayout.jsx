import React from 'react';
import AppShell from '../components/AppShell';
import {
  LayoutDashboard,
  FileText,
  AlertTriangle,
  UserPlus,
  Lock,
} from 'lucide-react';

const AdminLayout = ({ children }) => {
  const menuItems = [
    {
      path: '/admin/dashboard',
      label: 'Workload Overview',
      description: 'BD capacity & lead distribution',
      icon: LayoutDashboard,
    },
    {
      path: '/admin/leads',
      label: 'Lead Intake',
      description: 'Add, upload & route leads',
      icon: FileText,
    },
    {
      path: '/admin/pending',
      label: 'Awaiting Assignment',
      description: 'Unassigned & manual assign',
      icon: AlertTriangle,
    },
    {
      path: '/admin/users',
      label: 'Team Access',
      description: 'Create admin & BD users',
      icon: UserPlus,
    },
    {
      path: '/reset-password',
      label: 'Account Security',
      description: 'Update login password',
      icon: Lock,
    },
  ];

  return (
    <AppShell title="BD Lead Routing" subtitle="Admin Portal" menuItems={menuItems}>
      {children}
    </AppShell>
  );
};

export default AdminLayout;
