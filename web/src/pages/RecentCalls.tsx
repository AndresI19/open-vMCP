import {
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Tag,
  Pagination,
} from "@carbon/react";
import { api, usePoll, usePaged } from "../api";

export default function RecentCalls() {
  const { data } = usePoll(api.calls, 4000);
  const calls = data ?? [];
  const { page, setPage, pageItems } = usePaged(calls);

  return (
    <>
      <h1 style={{ marginBottom: "1.5rem" }}>Recent Calls</h1>
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
              <TableCell>{new Date(c.createdAt).toLocaleTimeString()}</TableCell>
              <TableCell>
                <code>{c.userExternalId ?? "—"}</code>
              </TableCell>
              <TableCell>{c.serverSlug ?? "—"}</TableCell>
              <TableCell>{c.toolName}</TableCell>
              <TableCell>
                <code style={{ fontSize: "0.75rem" }}>
                  {JSON.stringify(c.arguments)}
                </code>
                {c.argsRedacted && (
                  <Tag type="warm-gray" size="sm" style={{ marginLeft: 8 }}>
                    redacted
                  </Tag>
                )}
              </TableCell>
              <TableCell>
                <Tag type={c.status === "ok" ? "green" : "red"}>{c.status}</Tag>
              </TableCell>
              <TableCell>{c.latencyMs != null ? `${c.latencyMs} ms` : "—"}</TableCell>
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
