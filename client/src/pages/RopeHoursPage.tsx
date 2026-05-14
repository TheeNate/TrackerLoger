import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Calendar, Clock, MapPin, Cable, User, Pencil, Upload, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { RopeHours } from "@shared/schema";
import { ProfileHeader } from "@/components/ProfileHeader";
import { EditRopeHourDialog } from "@/components/EditRopeHourDialog";
import { ImportLogDialog } from "@/components/ImportLogDialog";
import { ImportedLogGroups } from "@/components/ImportedLogGroups";
import { SourceDocumentLink } from "@/components/SourceDocumentLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function RopeHoursPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [hours, setHours] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRopeHour, setEditingRopeHour] = useState<RopeHours | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const { toast } = useToast();

  // Query user data
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/user"]
  });

  // Fetch rope hours
  const { data: ropeHours = [], isLoading } = useQuery({
    queryKey: ["/api/rope-hours"],
    enabled: !!user
  });

  // Fetch supervisors
  const { data: supervisors = [] } = useQuery({
    queryKey: ["/api/supervisors"],
    enabled: !!user
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!startDate || !endDate || !location || !skills || !hours) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    if (new Date(startDate) >= new Date(endDate)) {
      toast({
        title: "Error",
        description: "End date must be after start date",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await apiRequest("POST", "/api/rope-hours", {
        startDate,
        endDate,
        location,
        skills,
        hours: parseFloat(hours),
      });

      toast({
        title: "Success",
        description: "Rope hours logged successfully",
      });
      
      // Reset form
      setStartDate("");
      setEndDate("");
      setLocation("");
      setSkills("");
      setHours("");
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/rope-hours"] });
    } catch (error) {
      console.error("Error logging rope hours:", error);
      toast({
        title: "Error",
        description: "Failed to log rope hours. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRopeHour = async (ropeHourId: number) => {
    try {
      await apiRequest("DELETE", `/api/rope-hours/${ropeHourId}`);
      toast({
        title: "Entry removed",
        description: "The rope-hours entry has been deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rope-hours"] });
    } catch (error: unknown) {
      console.error("Error deleting rope hour:", error);
      const message =
        error instanceof Error ? error.message : "Please try again.";
      toast({
        title: "Could not remove entry",
        description: message,
        variant: "destructive",
      });
    }
  };

  const renderDeleteButton = (entry: RopeHours, warnVerified: boolean) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
          aria-label="Delete rope hours entry"
          title="Delete entry"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            {warnVerified ? "This entry has already been verified. " : ""}
            This will permanently delete the rope-hours entry from{" "}
            {format(new Date(entry.startDate), "MMM dd, yyyy")} –{" "}
            {format(new Date(entry.endDate), "MMM dd, yyyy")} at {entry.location}.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handleDeleteRopeHour(entry.id)}
            className="bg-red-600 hover:bg-red-700"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const handleVerifyRequest = async (ropeHourId: number, supervisorId: number) => {
    try {
      await apiRequest("POST", `/api/verify-request-rope/${ropeHourId}`, {
        supervisorId,
      });

      toast({
        title: "Success",
        description: "Verification request sent to supervisor",
      });
    } catch (error) {
      console.error("Error sending verification request:", error);
      toast({
        title: "Error",
        description: "Failed to send verification request. Please try again.",
        variant: "destructive",
      });
    }
  };

  const calculateTotalHours = () => {
    return ropeHours.reduce((total: number, entry: RopeHours) => {
      return entry.verified ? total + entry.hours : total;
    }, 0);
  };

  if (isLoadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return null; // Protected route will handle redirect
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <ProfileHeader user={user} verifiedEntries={[]} />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Cable className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold">Rope Hours Tracking</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsImportDialogOpen(true)}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import from signed log
          </Button>
        </div>

      {/* Total Hours Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Total Verified Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">
            {calculateTotalHours().toFixed(1)} hours
          </div>
        </CardContent>
      </Card>

      {/* Log New Rope Hours Form */}
      <Card>
        <CardHeader>
          <CardTitle>Log New Rope Hours</CardTitle>
          <CardDescription>
            Record your rope access training hours with date range and skills used
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>
            
            <div>
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="Enter work location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
              />
            </div>
            
            <div>
              <Label htmlFor="skills">Skills Used</Label>
              <Textarea
                id="skills"
                placeholder="Describe the skills and techniques used during this rope hours session"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                required
              />
            </div>
            
            <div>
              <Label htmlFor="hours">Hours</Label>
              <Input
                id="hours"
                type="number"
                step="0.1"
                min="0"
                placeholder="Enter hours worked"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
              />
            </div>
            
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Logging..." : "Log Rope Hours"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ImportedLogGroups
        records={ropeHours as RopeHours[]}
        recordType="rope"
      />

      {/* Rope Hours History */}
      <Card>
        <CardHeader>
          <CardTitle>Rope Hours History</CardTitle>
          <CardDescription>
            Your logged rope hours and verification status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading rope hours...</div>
          ) : ropeHours.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No rope hours logged yet
            </div>
          ) : (
            <div className="space-y-4">
              {ropeHours.map((entry: RopeHours) => {
                const isImported = !!entry.importedAt;
                return (
                <div
                  key={entry.id}
                  className={`p-4 border rounded-lg ${
                    isImported
                      ? "border-neutral-200 bg-neutral-50 text-neutral-600"
                      : entry.verified
                      ? "border-green-200 bg-green-50"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span className="font-medium">
                          {format(new Date(entry.startDate), "MMM dd, yyyy")} - {format(new Date(entry.endDate), "MMM dd, yyyy")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-500" />
                        <span>{entry.location}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-gray-500" />
                        <span>{entry.hours} hours</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Cable className="h-4 w-4 text-gray-500 mt-1" />
                        <div>
                          <span className="font-medium">Skills: </span>
                          <span className="text-gray-700">{entry.skills}</span>
                        </div>
                      </div>
                      {isImported ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileText className="h-4 w-4 text-neutral-500" />
                          <span className="text-neutral-600 text-sm">
                            Imported from signed log
                            {entry.importedAt
                              ? ` on ${format(new Date(entry.importedAt), "MMM dd, yyyy")}`
                              : ""}
                          </span>
                          <SourceDocumentLink
                            recordType="rope"
                            recordId={entry.id}
                          />
                        </div>
                      ) : entry.verified ? (
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-green-600" />
                          <span className="text-green-600">
                            Verified by {entry.verifiedBy} on{" "}
                            {entry.verifiedAt ? format(new Date(entry.verifiedAt), "MMM dd, yyyy") : "N/A"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {isImported ? (
                        <>
                          <span className="px-2 py-1 bg-neutral-200 text-neutral-700 rounded text-sm">
                            Imported
                          </span>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                aria-label="Remove imported rope hours entry"
                                title="Remove imported entry"
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Remove
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remove this imported entry?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will delete the imported rope-hours
                                  entry from{" "}
                                  {format(new Date(entry.startDate), "MMM dd, yyyy")}{" "}
                                  – {format(new Date(entry.endDate), "MMM dd, yyyy")}{" "}
                                  at {entry.location}. If no other entries
                                  reference the uploaded log, the original
                                  file will also be removed from storage. This
                                  cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteImported(entry.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : entry.verified ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
                            Verified
                          </span>
                          {renderDeleteButton(entry, true)}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-sm">
                            Pending
                          </span>
                          {!entry.verificationRequestedAt && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingRopeHour(entry)}
                              aria-label="Edit entry"
                              title="Edit entry"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {supervisors.length > 0 && (
                            <Select
                              onValueChange={(value) => handleVerifyRequest(entry.id, parseInt(value))}
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Request Verification" />
                              </SelectTrigger>
                              <SelectContent>
                                {supervisors.map((supervisor: any) => (
                                  <SelectItem key={supervisor.id} value={supervisor.id.toString()}>
                                    {supervisor.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {renderDeleteButton(entry, false)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </main>

      <ImportLogDialog
        open={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        type="rope"
      />

      <EditRopeHourDialog
        ropeHour={editingRopeHour}
        open={!!editingRopeHour}
        onClose={() => setEditingRopeHour(null)}
      />
    </div>
  );
}