import { redirect } from 'next/navigation';
import { getOwner } from '@/server/api';
import { ToastProvider } from '@/components/ui';
import { QueryProvider } from '@/components/providers/query-provider';
import { Splash } from '@/components/boot/splash';
import { AppShell } from './app-shell';

/**
 * Everything inside this group needs a signed-in user. The proxy redirects on a missing cookie;
 * this asks the API, which verifies the session.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwner();
  if (!owner) redirect('/login');

  return (
    <QueryProvider>
      <ToastProvider>
        <Splash />
        <AppShell email={owner.email}>{children}</AppShell>
      </ToastProvider>
    </QueryProvider>
  );
}
