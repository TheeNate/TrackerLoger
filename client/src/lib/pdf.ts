import { jsPDF } from "jspdf";
import 'jspdf-autotable';
import { Entry, User, NDTMethod } from "@shared/schema";

// Fix for TypeScript to recognize autoTable as part of jsPDF
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

// Function to generate PDF from verified entries
export const generatePdf = async (
  entries: Entry[],
  user: Partial<User>
): Promise<void> => {
  // Create a new PDF document
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  
  // Set fonts
  doc.setFont("helvetica");
  
  // Add title
  doc.setFontSize(16);
  doc.text("Experience Hours (OJT)", 14, 15);
  
  // Add user information
  doc.setFontSize(10);
  doc.text(`Employee Name: ${user.name || ""}`, 14, 25);
  doc.text(`Employee Number: ${user.employeeNumber || ""}`, 120, 25);
  
  // Calculate totals for each method
  const totals: Record<string, number> = {
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
  
  // Format entries for the table
  const tableData = entries.map((entry) => {
    // Format date
    const date = new Date(entry.date);
    const formattedDate = date.toLocaleDateString();
    
    // Format method name for display
    const getMethodDisplay = (method: string) => {
      return method === "UT_THK" ? "UT Thk." : method;
    };
    
    // Initialize row with empty cells
    const row = [
      formattedDate,
      entry.location,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      entry.verifiedBy || "",
    ];
    
    // Add hours to the appropriate column
    const methodIndex = getMethodIndex(entry.method);
    if (methodIndex !== -1) {
      row[methodIndex] = entry.hours.toFixed(1);
      totals[entry.method] += entry.hours;
    }
    
    return row;
  });
  
  // Add total row
  const totalRow = [
    "Total Hours",
    "",
    totals.ET.toFixed(1),
    totals.RFT.toFixed(1),
    totals.MT.toFixed(1),
    totals.PT.toFixed(1),
    totals.RT.toFixed(1),
    totals.UT_THK.toFixed(1),
    totals.UTSW.toFixed(1),
    totals.PMI.toFixed(1),
    totals.LSI.toFixed(1),
    "",
  ];
  
  // Define table columns
  const columns = [
    "Job Date",
    "Job Location",
    "ET",
    "RFT",
    "MT",
    "PT",
    "RT",
    "UT Thk.",
    "UTSW",
    "PMI",
    "LSI",
    "Supervisor Signature",
  ];
  
  // Add table to the PDF
  doc.autoTable({
    head: [columns],
    body: [...tableData, totalRow],
    startY: 35,
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [220, 220, 220],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
  });
  
  // Add certification text
  const tableEndY = (doc as any).lastAutoTable.finalY + 10;
  doc.text("The above is true and accurate to the best of my knowledge.", 14, tableEndY);
  
  // Add signature line
  doc.text(`Employee Signature: ${user.name || ""}`, 14, tableEndY + 10);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 120, tableEndY + 10);
  
  // Add form number at the bottom
  doc.setFontSize(8);
  doc.text("100-FORM-95 Rev 0", 14, 200);
  
  // Save the PDF
  doc.save(`OJT_Log_${user.name || "User"}_${new Date().toISOString().split("T")[0]}.pdf`);
};

// Helper function to get the column index for a method
const getMethodIndex = (method: string): number => {
  const methodIndices: Record<string, number> = {
    ET: 2,
    RFT: 3,
    MT: 4,
    PT: 5,
    RT: 6,
    UT_THK: 7,
    UTSW: 8,
    PMI: 9,
    LSI: 10,
  };
  
  return methodIndices[method] || -1;
};
