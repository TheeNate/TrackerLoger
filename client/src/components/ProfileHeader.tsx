import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  FileSpreadsheet,
  ClipboardList,
  Cable,
  Settings,
  UserCheck,
} from "lucide-react";
import { generatePdf } from "@/lib/pdf";
import { ConnectivityChip } from "@/components/ConnectivityChip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useOnlineStatus } from "@/lib/offline/online";

interface ProfileHeaderProps {
  user: Partial<User>;
  verifiedEntries: any[];
}

export function ProfileHeader({ user, verifiedEntries }: ProfileHeaderProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const online = useOnlineStatus();

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.clear();
      // Wipe the offline API cache so the next user can't see prior data.
      if (typeof caches !== "undefined") {
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith("ojt-api-"))
              .map((k) => caches.delete(k)),
          );
        } catch {
          /* ignore */
        }
      }
      setLocation("/");
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to log out. Please try again.",
        variant: "destructive",
      });
    }
  };

  const requireOnline = (action: string): boolean => {
    if (!online) {
      toast({
        title: "Requires internet",
        description: `${action} is unavailable while offline. Reconnect and try again.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const handleExportPdf = async () => {
    if (!requireOnline("Export PDF")) return;
    if (verifiedEntries.length === 0) {
      toast({
        title: "No verified entries",
        description: "You need at least one verified entry to export as PDF.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      await generatePdf(verifiedEntries, user);
      toast({
        title: "PDF exported",
        description: "Your verified hours have been exported as PDF.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to export PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleAdminClick = () => {
    if (!requireOnline("Admin")) return;
    setLocation("/admin");
  };

  return (
    <>
      <header className="bg-card shadow-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">
              Hours Tracker
            </h1>
            <ConnectivityChip />
          </div>

          <div className="flex items-center space-x-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="text-sm text-primary hover:text-primary/80 focus:outline-none"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setLocation("/profile")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                location === "/profile"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                OJT Hours
              </div>
            </button>
            <button
              onClick={() => setLocation("/rope-hours")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                location === "/rope-hours"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <Cable className="h-4 w-4" />
                Rope Hours
              </div>
            </button>
            <button
              onClick={() => setLocation("/signers")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                location === "/signers"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                Signers
              </div>
            </button>
            {user.isAdmin && (
              <button
                onClick={handleAdminClick}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  location === "/admin"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                } ${!online ? "opacity-60" : ""}`}
                title={online ? "Admin" : "Admin requires internet"}
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Admin
                </div>
              </button>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="sm:flex sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">
                {user.name || "New User"}
              </h2>
              {user.employeeNumber && (
                <p className="text-sm text-neutral-500">
                  Employee #: {user.employeeNumber}
                </p>
              )}
            </div>

            <div className="mt-4 sm:mt-0">
              <Button
                variant="outline"
                onClick={handleExportPdf}
                disabled={
                  isExporting || verifiedEntries.length === 0 || !online
                }
                className="inline-flex items-center"
                title={
                  online
                    ? "Export verified hours as PDF"
                    : "Export requires internet"
                }
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {isExporting ? "Exporting..." : "Export Verified Hours as PDF"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
