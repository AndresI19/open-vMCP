import { ScaleTypes } from '@carbon/charts';
import { GroupedBarChart } from '@carbon/charts-react';
import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tile,
} from '@carbon/react';
import { api, usePaged, usePoll } from '../api';
import { useCardLabels } from '../components/useCardLabels';

export default function ToolUsage() {
  const cards = useCardLabels();
  const { data: tools } = usePoll(api.byTool);
  const rows = tools ?? [];
  const { page, setPage, pageItems } = usePaged(rows);

  const chartData = rows.flatMap((t) => [
    { group: 'ok', key: t.tool, value: t.ok },
    { group: 'error', key: t.tool, value: t.errors },
  ]);

  return (
    <>
      <h1 style={{ marginBottom: '1.5rem' }}>Tool Usage</h1>

      <Tile style={{ marginBottom: '1.5rem' }}>
        <GroupedBarChart
          data={chartData}
          options={{
            title: 'Calls by tool (ok vs error)',
            axes: {
              left: { mapsTo: 'value', title: 'Calls' },
              bottom: { mapsTo: 'key', scaleType: ScaleTypes.LABELS, title: 'Tool' },
            },
            height: '400px',
          }}
        />
      </Tile>

      <div ref={cards}>
        <TableContainer>
          <Table size="lg">
            <TableHead>
              <TableRow>
                <TableHeader>Tool</TableHeader>
                <TableHeader>Total</TableHeader>
                <TableHeader>OK</TableHeader>
                <TableHeader>Errors</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageItems.map((t) => (
                <TableRow key={t.tool}>
                  <TableCell>{t.tool}</TableCell>
                  <TableCell>{t.total}</TableCell>
                  <TableCell>{t.ok}</TableCell>
                  <TableCell>{t.errors}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
      <Pagination
        totalItems={rows.length}
        pageSize={20}
        pageSizes={[20]}
        page={page}
        onChange={({ page: p }) => setPage(p)}
      />
    </>
  );
}
