import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { api, usePaged, usePoll } from '../api';
import { DASH, StatusTag, fmtLatency, fmtTime } from '../format';

export default function RecentCalls() {
  const { data } = usePoll(api.calls, 4000);
  const calls = data ?? [];
  const { page, setPage, pageItems } = usePaged(calls);

  return (
    <>
      <h1 style={{ marginBottom: '1.5rem' }}>Recent Calls</h1>
      <Table size="lg">
        <TableHead>
          <TableRow>
            <TableHeader>Time</TableHeader>
            <TableHeader>User</TableHeader>
            <TableHeader>Server</TableHeader>
            <TableHeader>Tool</TableHeader>
            <TableHeader>Arguments</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Latency</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {pageItems.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{fmtTime(c.createdAt)}</TableCell>
              <TableCell>
                <code>{c.userExternalId ?? DASH}</code>
              </TableCell>
              <TableCell>{c.serverSlug ?? DASH}</TableCell>
              <TableCell>{c.toolName}</TableCell>
              <TableCell>
                <code style={{ fontSize: '0.75rem' }}>{JSON.stringify(c.arguments)}</code>
                {c.argsRedacted && (
                  <Tag type="warm-gray" size="sm" style={{ marginLeft: 8 }}>
                    redacted
                  </Tag>
                )}
              </TableCell>
              <TableCell>
                <StatusTag status={c.status} />
              </TableCell>
              <TableCell>{fmtLatency(c.latencyMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        totalItems={calls.length}
        pageSize={20}
        pageSizes={[20]}
        page={page}
        onChange={({ page: p }) => setPage(p)}
      />
    </>
  );
}
