import { useMemo } from "react";
import { Entry } from "@shared/schema";
import { EntryRow } from "@/components/EntryRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ListChecks } from "lucide-react";

interface OJTTableProps {
  entries: Entry[];
  onVerifyRequest: (entry: Entry) => void;
  selectedEntryIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onBatchVerifyRequest: () => void;
  onEditEntry?: (entry: Entry) => void;
}

export function OJTTable({
  entries,
  onVerifyRequest,
  selectedEntryIds,
  onToggleSelect,
  onBatchVerifyRequest,
  onEditEntry,
}: OJTTableProps) {
  const totals = useMemo(() => {
    const initialTotals: Record<string, number> = {
      ET: 0, RFT: 0, MT: 0, PT: 0, RT: 0, UT_THK: 0, UTSW: 0, PMI: 0, LSI: 0,
    };
    return entries.reduce((acc, entry) => {
      acc[entry.method] += entry.hours;
      return acc;
    }, initialTotals);
  }, [entries]);

  const unverifiedEntries = entries.filter((e) => !e.verified);
  const allUnverifiedSelected =
    unverifiedEntries.length > 0 &&
    unverifiedEntries.every((e) => selectedEntryIds.has(e.id));

  const handleSelectAll = () => {
    if (allUnverifiedSelected) {
      unverifiedEntries.forEach((e) => onToggleSelect(e.id));
    } else {
      unverifiedEntries.filter((e) => !selectedEntryIds.has(e.id)).forEach((e) => onToggleSelect(e.id));
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">Experience Hours (OJT) Log</h2>
        {selectedEntryIds.size >= 2 && (
          <Button
            onClick={onBatchVerifyRequest}
            size="sm"
            className="flex items-center gap-2"
          >
            <ListChecks className="h-4 w-4" />
            Request Batch Verification ({selectedEntryIds.size} entries)
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 ojt-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-3 text-left w-8">
                {unverifiedEntries.length > 0 && (
                  <Checkbox
                    checked={allUnverifiedSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all unverified entries"
                  />
                )}
              </th>
              <th scope="col" className="px-4 py-3 text-left">Job Date</th>
              <th scope="col" className="px-4 py-3 text-left">Job Location</th>
              <th scope="col" className="px-4 py-3 text-left">ET</th>
              <th scope="col" className="px-4 py-3 text-left">RFT</th>
              <th scope="col" className="px-4 py-3 text-left">MT</th>
              <th scope="col" className="px-4 py-3 text-left">PT</th>
              <th scope="col" className="px-4 py-3 text-left">RT</th>
              <th scope="col" className="px-4 py-3 text-left">UT Thk.</th>
              <th scope="col" className="px-4 py-3 text-left">UTSW</th>
              <th scope="col" className="px-4 py-3 text-left">PMI</th>
              <th scope="col" className="px-4 py-3 text-left">LSI</th>
              <th scope="col" className="px-4 py-3 text-left">Supervisor Signature</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-neutral-200">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onVerifyRequest={onVerifyRequest}
                isSelected={selectedEntryIds.has(entry.id)}
                onToggleSelect={onToggleSelect}
                onEdit={onEditEntry}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-100">
              <td className="px-3 py-3"></td>
              <td colSpan={2} className="px-4 py-3 text-sm font-medium text-neutral-900">Total Hours:</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.ET.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.RFT.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.MT.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.PT.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.RT.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.UT_THK.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.UTSW.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.PMI.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900">{totals.LSI.toFixed(1)}</td>
              <td className="px-4 py-3 text-sm font-medium text-neutral-900"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
        {unverifiedEntries.length > 0 && (
          <span>
            Select 2 or more unverified entries to request batch verification.
          </span>
        )}
        <div className="flex items-center space-x-1 ml-auto">
          <span className="inline-block w-3 h-3 rounded-full bg-green-100"></span>
          <span>Verified Entry</span>
        </div>
      </div>
    </div>
  );
}
