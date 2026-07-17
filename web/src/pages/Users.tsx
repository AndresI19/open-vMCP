import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { api, usePaged, usePoll } from '../api';
import { useCardLabels } from '../components/useCardLabels';

export default function Users() {
  const cards = useCardLabels();
  const { data } = usePoll(api.users, 8000);
  const users = data ?? [];
  const { page, setPage, pageItems } = usePaged(users);

  return (
    <>
      <h1 style={{ marginBottom: '1.5rem' }}>Users</h1>
      <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '1.5rem' }}>
        Identities decoded from the bearer token on each proxied call.
      </p>
      <div ref={cards}>
        <TableContainer>
          <Table size="lg">
            <TableHead>
              <TableRow>
                <TableHeader>User</TableHeader>
                <TableHeader>Tool calls</TableHeader>
                <TableHeader>First seen</TableHeader>
                <TableHeader>Last seen</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageItems.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <code>{u.externalId}</code>
                  </TableCell>
                  <TableCell>{u.calls}</TableCell>
                  <TableCell>{new Date(u.firstSeen).toLocaleString()}</TableCell>
                  <TableCell>{new Date(u.lastSeen).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
      <Pagination
        totalItems={users.length}
        pageSize={20}
        pageSizes={[20]}
        page={page}
        onChange={({ page: p }) => setPage(p)}
      />
    </>
  );
}
