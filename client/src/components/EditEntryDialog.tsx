import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Entry } from "@shared/schema";

const formSchema = z.object({
  date: z.string().min(1, "Date is required"),
  location: z.string().min(1, "Location is required"),
  method: z.string().min(1, "Method is required"),
  hours: z.number().min(0.1, "Hours must be greater than 0"),
});

type FormValues = z.infer<typeof formSchema>;

const methodOptions = [
  { value: "ET", label: "ET" },
  { value: "RFT", label: "RFT" },
  { value: "MT", label: "MT" },
  { value: "PT", label: "PT" },
  { value: "RT", label: "RT" },
  { value: "UT_THK", label: "UT Thk." },
  { value: "UTSW", label: "UTSW" },
  { value: "PMI", label: "PMI" },
  { value: "LSI", label: "LSI" },
];

interface EditEntryDialogProps {
  entry: Entry | null;
  open: boolean;
  onClose: () => void;
}

export function EditEntryDialog({ entry, open, onClose }: EditEntryDialogProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { date: "", location: "", method: "", hours: 0 },
  });

  useEffect(() => {
    if (entry && open) {
      form.reset({
        date: new Date(entry.date).toISOString().split("T")[0],
        location: entry.location,
        method: entry.method,
        hours: entry.hours,
      });
    }
  }, [entry, open, form]);

  const handleSubmit = async (values: FormValues) => {
    if (!entry) return;
    setIsSaving(true);
    try {
      const res = await apiRequest("PATCH", `/api/entries/${entry.id}`, {
        date: values.date,
        location: values.location,
        method: values.method,
        hours: Number(values.hours),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update entry");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
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
          <DialogTitle>Edit OJT Entry</DialogTitle>
          <DialogDescription>
            Make changes to this entry. Once it's been verified, it can no longer be edited.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Location</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>NDT Method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {methodOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
