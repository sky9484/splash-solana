import AdminSupportConsole from '@/components/admin/AdminSupportConsole';
import { listSupportTickets } from '@/lib/server/support';

export const dynamic = 'force-dynamic';

export default function AdminSupportPage() {
  return <AdminSupportConsole initialTickets={listSupportTickets()} />;
}
