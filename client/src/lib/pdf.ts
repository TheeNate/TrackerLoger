import { jsPDF } from "jspdf";
import { Entry, User } from "@shared/schema";

// Function to create a simplified PDF without using the autoTable plugin
export const generatePdf = async (
  entries: Entry[],
  user: Partial<User>
): Promise<void> => {
  try {
    // Create a new PDF document
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    
    // Set fonts and styles
    doc.setFont("helvetica");
    
    // Add title
    doc.setFontSize(16);
    doc.text("Experience Hours (OJT)", 14, 15);
    
    // Add user information
    doc.setFontSize(10);
    doc.text(`Employee Name: ${user.name || ""}`, 14, 25);
    doc.text(`Employee Number: ${user.employeeNumber || ""}`, 120, 25);
    
    // Calculate totals for each method
    const totals = {
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
    
    // Track verified entries
    const verifiedEntries = entries.filter(entry => entry.verified);
    
    // Process entries to calculate totals
    verifiedEntries.forEach(entry => {
      const methodKey = entry.method as keyof typeof totals;
      if (methodKey in totals) {
        totals[methodKey] += entry.hours;
      }
    });
    
    // Create manual table using lines and text
    const startY = 35;
    const rowHeight = 8;
    const colWidths = [25, 40, 15, 15, 15, 15, 15, 15, 15, 15, 15, 40];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    
    // Draw table header
    const headers = [
      "Job Date", "Job Location", "ET", "RFT", "MT", "PT", 
      "RT", "UT Thk.", "UTSW", "PMI", "LSI", "Supervisor"
    ];
    
    // Draw header rectangle
    doc.setFillColor(220, 220, 220);
    doc.rect(14, startY, totalWidth, rowHeight, 'F');
    
    // Draw header text
    doc.setFontSize(8);
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    
    let xPos = 14;
    headers.forEach((header, i) => {
      doc.text(header, xPos + 2, startY + 5);
      xPos += colWidths[i];
    });
    
    // Draw entry rows
    doc.setFont("helvetica", "normal");
    let yPos = startY + rowHeight;
    
    // Draw alternating rows
    verifiedEntries.forEach((entry, index) => {
      // Set alternating row colors
      if (index % 2 === 0) {
        doc.setFillColor(250, 250, 250);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      
      doc.rect(14, yPos, totalWidth, rowHeight, 'F');
      
      // Format date
      const date = new Date(entry.date);
      const formattedDate = date.toLocaleDateString();
      
      // Draw cell contents
      xPos = 14;
      
      // Date
      doc.text(formattedDate, xPos + 2, yPos + 5);
      xPos += colWidths[0];
      
      // Location
      doc.text(entry.location, xPos + 2, yPos + 5);
      xPos += colWidths[1];
      
      // Method hours (put value in correct column)
      const methodColumns = ["ET", "RFT", "MT", "PT", "RT", "UT_THK", "UTSW", "PMI", "LSI"];
      methodColumns.forEach((method, i) => {
        if (entry.method === method) {
          doc.text(entry.hours.toFixed(1), xPos + 2, yPos + 5);
        }
        xPos += colWidths[i + 2];
      });
      
      // Supervisor
      doc.text(entry.verifiedBy || "", xPos + 2, yPos + 5);
      
      yPos += rowHeight;
    });
    
    // Draw total row
    doc.setFillColor(240, 240, 240);
    doc.rect(14, yPos, totalWidth, rowHeight, 'F');
    
    doc.setFont("helvetica", "bold");
    doc.text("Total Hours", 16, yPos + 5);
    
    // Draw total values
    xPos = 14 + colWidths[0] + colWidths[1];
    Object.values(totals).forEach((total, i) => {
      doc.text(total.toFixed(1), xPos + 2, yPos + 5);
      xPos += colWidths[i + 2];
    });
    
    // Draw table border
    doc.setDrawColor(0);
    doc.rect(14, startY, totalWidth, yPos - startY + rowHeight);
    
    // Add vertical lines for columns
    xPos = 14;
    for (let i = 0; i < colWidths.length; i++) {
      xPos += colWidths[i];
      doc.line(xPos, startY, xPos, yPos + rowHeight);
    }
    
    // Add certification text
    const tableEndY = yPos + rowHeight + 10;
    doc.setFont("helvetica", "normal");
    doc.text("The above is true and accurate to the best of my knowledge.", 14, tableEndY);
    
    // Add signature line
    doc.text(`Employee Signature: ${user.name || ""}`, 14, tableEndY + 10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 120, tableEndY + 10);
    
    // Add form number at the bottom
    doc.setFontSize(8);
    doc.text("100-FORM-95 Rev 0", 14, 200);
    
    // Save the PDF
    doc.save(`OJT_Log_${user.name || "User"}_${new Date().toISOString().split("T")[0]}.pdf`);
    console.log("PDF generated successfully");
  } catch (error) {
    console.error("PDF generation error:", error);
    throw new Error("Failed to generate PDF");
  }
};