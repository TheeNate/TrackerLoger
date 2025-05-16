import { Entry } from "@shared/schema";
import { Button } from "@/components/ui/button";

interface EntryRowProps {
  entry: Entry;
  onVerifyRequest: (entry: Entry) => void;
}

export function EntryRow({ entry, onVerifyRequest }: EntryRowProps) {
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString();
  };
  
  // Create hour cells for each NDT method
  const createHourCell = (method: string) => {
    if (entry.method === method) {
      return (
        <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-900">
          {entry.hours.toFixed(1)}
        </td>
      );
    }
    return <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-900"></td>;
  };
  
  return (
    <tr className={entry.verified ? "bg-green-50" : ""}>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-900">
        {formatDate(entry.date)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-900">
        {entry.location}
      </td>
      {createHourCell("ET")}
      {createHourCell("RFT")}
      {createHourCell("MT")}
      {createHourCell("PT")}
      {createHourCell("RT")}
      {createHourCell("UT_THK")}
      {createHourCell("UTSW")}
      {createHourCell("PMI")}
      {createHourCell("LSI")}
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        {entry.verified ? (
          <div className="flex items-center">
            <svg className="mr-1.5 h-2 w-2 text-green-500" fill="currentColor" viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="3" />
            </svg>
            <span className="text-green-700">Verified by {entry.verifiedBy}</span>
          </div>
        ) : (
          <Button 
            onClick={() => onVerifyRequest(entry)}
            size="sm"
            variant="outline"
            className="text-xs"
          >
            Request Verification
          </Button>
        )}
      </td>
    </tr>
  );
}