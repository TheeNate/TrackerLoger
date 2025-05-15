import { useEffect } from "react";
import { useLocation } from "wouter";
import { AuthForm } from "@/components/AuthForm";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check if user is already logged in
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  
  // Redirect to profile if already logged in
  useEffect(() => {
    if (user && !isLoading) {
      setLocation("/profile");
    }
  }, [user, isLoading, setLocation]);
  
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Form side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4">
        <AuthForm />
      </div>
      
      {/* Hero side */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary relative items-center justify-center">
        <div className="absolute inset-0 bg-black opacity-20"></div>
        <div className="z-10 text-center p-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            Streamline Your OJT Progress Tracking
          </h2>
          <p className="text-white text-lg mb-6">
            Keep track of your training hours, get supervisor verification, and generate verified reports for your certifications.
          </p>
          <ul className="text-white text-left space-y-3 max-w-md mx-auto">
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Track hours by NDT method categories
            </li>
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Request verification from supervisors
            </li>
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Export verified logs as PDF documents
            </li>
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Monitor progress toward certification requirements
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}