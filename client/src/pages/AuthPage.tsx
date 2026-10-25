import { useEffect } from "react";
import { useLocation } from "wouter";
import { AuthForm } from "@/components/AuthForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { HOME_PATH, ROPE_ONLY } from "@/lib/edition";

const HERO = ROPE_ONLY
  ? {
      title: "Your Rope Access Logbook",
      blurb: "Log your hours on your phone, get them signed by your supervisor, and see exactly how close you are to your next SPRAT or IRATA level.",
      points: [
        "SPRAT and IRATA hours: ascents, descents, rope transfers, hauling, rigging",
        "Supervisor sign-off in the app, no paper to lose",
        "Progress to your next level: hours and time at level",
        "Export to SPRAT / IRATA log forms, PDF or CSV",
      ],
    }
  : {
      title: "Streamline Your OJT Progress Tracking",
      blurb: "Keep track of your training hours, get supervisor verification, and generate verified reports for your certifications.",
      points: [
        "Track hours by NDT method categories",
        "Request verification from supervisors",
        "Export verified logs as PDF documents",
        "Monitor progress toward certification requirements",
      ],
    };

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check if user is already logged in
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });
  
  // Redirect to appropriate page if already logged in. Honors ?next= for
  // OAuth flows that bounce through login (same-origin paths only).
  useEffect(() => {
    if (user && !isLoading) {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        window.location.replace(next);
        return;
      }
      if ((user as any).isAdmin) {
        setLocation("/admin");
      } else {
        setLocation(HOME_PATH);
      }
    }
  }, [user, isLoading, setLocation]);
  
  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen bg-background relative">
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      {/* Form side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4">
        <AuthForm />
      </div>
      
      {/* Hero side */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary relative items-center justify-center">
        <div className="absolute inset-0 bg-black opacity-20"></div>
        <div className="z-10 text-center p-8">
          <h2 className="text-3xl font-bold text-white mb-4">{HERO.title}</h2>
          <p className="text-white text-lg mb-6">{HERO.blurb}</p>
          <ul className="text-white text-left space-y-3 max-w-md mx-auto">
            {HERO.points.map((point) => (
              <li key={point} className="flex items-center">
                <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}