import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Entry, Supervisor } from "@shared/schema";
import { supervisorFormSchema, type SupervisorFormValues } from "@/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, Copy } from "lucide-react";

interface SupervisorVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entry?: Entry | null;
  entries?: Entry[];
}

export function SupervisorVerifyModal({ isOpen, onClose, onSuccess, entry, entries }: SupervisorVerifyModalProps) {
  const isBatchMode = Array.isArray(entries) && entries.length >= 2;
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>("new");
  const [verificationUrl, setVerificationUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const form = useForm<SupervisorFormValues>({
    resolver: zodResolver(supervisorFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      certificationLevel: "Level I",
      company: "",
    },
  });

  useEffect(() => {
    if (isOpen) {
      loadSupervisors();
      setSelectedSupervisor("new");
      setVerificationUrl("");
      form.reset();
    }
  }, [isOpen, form]);

  const loadSupervisors = async () => {
    try {
      const response = await fetch("/api/supervisors", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setSupervisors(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSupervisorChange = (value: string) => {
    setSelectedSupervisor(value);
    if (value === "new") {
      form.reset();
    } else if (value) {
      const supervisor = supervisors.find((s) => s.id.toString() === value);
      if (supervisor) {
        form.setValue("name", supervisor.name);
        form.setValue("email", supervisor.email);
        form.setValue("phone", supervisor.phone);
        form.setValue("certificationLevel", supervisor.certificationLevel as any);
        form.setValue("company", supervisor.company);
      }
    }
  };

  const handleSubmit = async (values: SupervisorFormValues) => {
    if (!isBatchMode && !entry) return;

    setIsLoading(true);
    setCopied(false);

    try {
      let supervisorId: number;

      if (selectedSupervisor && selectedSupervisor !== "new") {
        supervisorId = parseInt(selectedSupervisor);
      } else {
        const supervisorResponse = await apiRequest("POST", "/api/supervisors", values);
        if (!supervisorResponse.ok) throw new Error("Failed to create supervisor");
        const newSupervisor = await supervisorResponse.json();
        supervisorId = newSupervisor.id;
      }

      if (isBatchMode) {
        const entryIds = entries!.map((e) => e.id);
        const response = await apiRequest("POST", "/api/batch-verify-request", { entryIds, supervisorId });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Failed to send batch verification request");
        }
        const data = await response.json();

        toast({
          title: "Batch verification request sent",
          description: `A single verification link has been sent to the supervisor for ${entries!.length} entries.`,
        });

        setVerificationUrl(data.verificationUrl);
      } else {
        const response = await apiRequest("POST", `/api/verify-request/${entry!.id}`, { supervisorId });
        const data = await response.json();

        toast({
          title: "Verification request sent",
          description: "A verification link has been generated. You can also share it directly if needed.",
        });

        if (data.entry && data.entry.verificationToken) {
          const url = `${window.location.origin}/verify/${data.entry.verificationToken}`;
          setVerificationUrl(url);
        } else {
          onSuccess();
          onClose();
        }
      }
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error",
        description: error.message || "Failed to send verification request. Please try again.",
        variant: "destructive",
      });
      setVerificationUrl("");
    } finally {
      setIsLoading(false);
    }
  };

  const formatMethod = (m: string) => (m === "UT_THK" ? "UT Thk." : m);

  const renderEntryDetails = () => {
    if (isBatchMode) {
      return (
        <div className="bg-neutral-100 rounded-md p-4 mb-4 space-y-1 max-h-48 overflow-y-auto">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            {entries!.length} entries selected
          </p>
          {entries!.map((e) => (
            <div key={e.id} className="flex justify-between text-sm">
              <span className="text-neutral-700">{new Date(e.date).toLocaleDateString()} — {e.location}</span>
              <span className="font-medium text-neutral-900 ml-4">{formatMethod(e.method)} {e.hours.toFixed(1)} h</span>
            </div>
          ))}
          <div className="border-t border-neutral-300 mt-2 pt-2 flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span>{entries!.reduce((s, e) => s + e.hours, 0).toFixed(1)} h</span>
          </div>
        </div>
      );
    }

    if (!entry) return null;
    return (
      <div className="bg-neutral-100 rounded-md p-4 mb-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-neutral-500">Date:</dt>
          <dd className="text-neutral-900 font-medium">{new Date(entry.date).toLocaleDateString()}</dd>
          <dt className="text-neutral-500">Location:</dt>
          <dd className="text-neutral-900 font-medium">{entry.location}</dd>
          <dt className="text-neutral-500">Method:</dt>
          <dd className="text-neutral-900 font-medium">{formatMethod(entry.method)}</dd>
          <dt className="text-neutral-500">Hours:</dt>
          <dd className="text-neutral-900 font-medium">{entry.hours.toFixed(1)}</dd>
        </dl>
      </div>
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setVerificationUrl("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isBatchMode ? "Batch Supervisor Verification" : "Supervisor Verification"}
          </DialogTitle>
          <DialogDescription>
            {isBatchMode
              ? "Choose a supervisor to send a single sign-off request for all selected entries."
              : "Please provide supervisor information to verify the following hours:"}
          </DialogDescription>
        </DialogHeader>

        {renderEntryDetails()}

        {verificationUrl ? (
          <div className="space-y-4">
            <Alert className="bg-amber-50 border-amber-200">
              <AlertDescription>
                {isBatchMode
                  ? "The batch verification email has been sent. You can also share this direct link:"
                  : "The verification email has been sent, but in case it wasn't received, you can share this direct verification link with the supervisor:"}
              </AlertDescription>
            </Alert>

            <div className="flex items-center space-x-2">
              <Input value={verificationUrl} readOnly className="flex-1 bg-gray-50" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(verificationUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex justify-end mt-4">
              <Button
                onClick={() => {
                  setVerificationUrl("");
                  onSuccess();
                  onClose();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="mb-4">
                <FormLabel>Select Saved Supervisor</FormLabel>
                <Select value={selectedSupervisor} onValueChange={handleSupervisorChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select or enter new supervisor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Enter new supervisor</SelectItem>
                    {supervisors.map((supervisor) => (
                      <SelectItem key={supervisor.id} value={supervisor.id.toString()}>
                        {supervisor.name} ({supervisor.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supervisor Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supervisor Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supervisor Phone</FormLabel>
                      <FormControl><Input type="tel" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="certificationLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Certification Level</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select certification level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Level I">Level I</SelectItem>
                          <SelectItem value="Level II">Level II</SelectItem>
                          <SelectItem value="Level III">Level III</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading
                    ? "Sending..."
                    : isBatchMode
                    ? `Send Batch Request (${entries!.length})`
                    : "Send for Verification"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
