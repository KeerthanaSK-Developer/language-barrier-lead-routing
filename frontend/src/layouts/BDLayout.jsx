import React from 'react';
import AppShell from '../components/AppShell';
import { FileText, Lock } from 'lucide-react';

const BDLayout = ({ children }) => {
  const menuItems = [
    {
      path: '/bd/leads',
      label: 'My Active Leads',
      description: 'Work & complete assignments',
      icon: FileText,
    },
    {
      path: '/reset-password',
      label: 'Account Security',
      description: 'Update login password',
      icon: Lock,
    },
  ];

  return (
    <AppShell title="BD Lead Routing" subtitle="BD Portal" menuItems={menuItems}>
      {children}
    </AppShell>
  );
};

export default BDLayout;
