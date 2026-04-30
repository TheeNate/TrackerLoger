import { useEffect, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RopeHours } from "@shared/schema";

interface EditRopeHourDialogProps {
  ropeHour: RopeHours | null;
  open: boolean;
  onClose: () => void;
}

export function EditRopeHourDialog({ ropeHour, open, onClose }: EditRopeHourDialogProps) {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [hours, setHours] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (ropeHour && open) {
      setStartDate(new Date(ropeHour.startDate).toISOString().split("T")[0]);
      setEndDate(new Date(ropeHour.endDate).toISOString().split("T")[0]);
      setLocation(ropeHour.location);
      setSkills(ropeHour.skills);
      setHours(String(ropeHour.hours));
    }
  }, [ropeHour, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ropeHour) return;

    if (!startDate || !endDate || !location || !skills || !hours) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      toast({ title: "Error", description: "End date must be after start date", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiRequest("PATCH", `/api/rope-hours/${ropeHour.id}`, {
        startDate,
        endDate,
        location,
        skills,
        hours: parseFloat(hours),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update entry");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/rope-hours"] });
      toast({ title: "Entry updated", description: "Your changes have been saved." });
      onClose();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Rope Hour Entry</DialogTitle>
          <DialogDescription>
            Make changes to this entry. Once it's been verified, it can no longer be edited.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-startDate">Start Date</Label>
              <Input
                id="edit-startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="edit-endDate">End Date</Label>
              <Input
                id="edit-endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-location">Location</Label>
            <Input
              id="edit-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-skills">Skills Used</Label>
            <Textarea
              id="edit-skills"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-hours">Hours</Label>
            <Input
              id="edit-hours"
              type="number"
              step="0.1"
              min="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
