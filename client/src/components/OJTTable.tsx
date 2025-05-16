import { useMemo } from "react";
import { Entry, NDTMethod, NDTMethods } from "@shared/schema";
import { EntryRow } from "@/components/EntryRow";

interface OJTTableProps {
  entries: Entry[];
  onVerifyRequest: (entry: Entry) => void;
}

export function OJTTable({ entries, onVerifyRequest }: OJTTableProps) {
  // Calculate totals for each method
  const totals = useMemo(() => {
    const initialTotals: Record<string, number> = {
      ET: 0,
      RFT: 0,
      MT: 0,
      PT: 0,
      RT: 0,
      UT_THK: 0,
      UTSW: 0,
      PMI: 0,
      LSI: 0,
    };
    
    return entries.reduce((acc, entry) => {
      acc[entry.method] += entry.hours;
      return acc;
    }, initialTotals);
  }, [entries]);
  
  // Format method display name
  const formatMethod = (method: string): string => {
    if (method === 'UT_THK') return 'UT Thk.';
    return method;
  };
  
  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">Experience Hours (OJT) Log</h2>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 ojt-table">
          <thead>
            <tr>
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
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-100">
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
      
      <div className="mt-6 text-right text-sm text-neutral-500">
        <div className="flex items-center justify-end space-x-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-100"></span>
          <span>Verified Entry</span>
        </div>
      </div>
    </div>
  );
}