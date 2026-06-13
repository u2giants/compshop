import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { Clock, LogOut, ShieldAlert } from "lucide-react";

export default function PendingApproval() {
  const { approvalStatus, approvalReason, signOut, user } = useAuth();
  const isBlocked = approvalStatus === "blocked";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {isBlocked ? <ShieldAlert className="h-6 w-6 text-destructive" /> : <Clock className="h-6 w-6 text-muted-foreground" />}
          </div>
          <CardTitle>{isBlocked ? "Account access blocked" : "Approval needed"}</CardTitle>
          <CardDescription>
            {isBlocked
              ? "This account cannot access CompShop."
              : "Your sign-in worked, but an admin needs to approve this account before the app opens."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{user?.email}</p>
            <p className="mt-1 text-muted-foreground">
              {approvalReason || (isBlocked ? "Contact an admin if this looks wrong." : "Ask a CompShop admin to approve your account.")}
            </p>
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
