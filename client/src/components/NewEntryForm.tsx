import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import { NDTMethods } from "@shared/schema";

const formSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string().min(1, "Date is required"),
      location: z.string().min(1, "Location is required"),
      method: z.string().min(1, "Method is required"),
      hours: z.number().min(0.1, "Hours must be greater than 0"),
    })
  ),
});

type FormValues = z.infer<typeof formSchema>;

export function NewEntryForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      entries: [
        {
          date: new Date().toISOString().split("T")[0],
          location: "",
          method: "",
          hours: 0,
        },
      ],
    },
  });
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });
  
  const handleAddEntry = () => {
    append({
      date: new Date().toISOString().split("T")[0],
      location: "",
      method: "",
      hours: 0,
    });
  };
  
  const handleSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    
    try {
      // Format entries for API
      const formattedEntries = values.entries.map((entry) => ({
        date: entry.date, // Server will convert to Date object
        location: entry.location,
        method: entry.method,
        hours: Number(entry.hours),
      }));
      
      await apiRequest("POST", "/api/entries", formattedEntries);
      
      // Reset form with a single empty entry
      form.reset({
        entries: [
          {
            date: new Date().toISOString().split("T")[0],
            location: "",
            method: "",
            hours: 0,
          },
        ],
      });
      
      // Invalidate entries query to refresh the table
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
      
      toast({
        title: "Entries added",
        description: "Your OJT hours have been saved successfully.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to save entries. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
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
  
  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">Add New OJT Hours</h2>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 mb-4">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Job Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Job Location</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">NDT Method</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Hours</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {fields.map((field, index) => (
                  <tr key={field.id} className="new-entry-row">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.date`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="date"
                                {...field}
                                className="w-full border-neutral-200 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.location`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                placeholder="Enter location"
                                {...field}
                                className="w-full border-neutral-200 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.method`}
                        render={({ field }) => (
                          <FormItem>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select method" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {methodOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.hours`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="0.5"
                                placeholder="0.0"
                                {...field}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                className="w-full border-neutral-200 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => {
                          if (fields.length > 1) {
                            remove(index);
                          }
                        }}
                        className="text-neutral-500 hover:text-status-error focus:outline-none"
                        disabled={fields.length <= 1}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center space-y-4 sm:space-y-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleAddEntry}
              className="inline-flex items-center"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Another Entry
            </Button>
            
            <Button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center"
            >
              {isSubmitting ? "Saving..." : "Save Entries"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}