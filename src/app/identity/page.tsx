import { Page } from "@/components/vault/ui";
import { IdentityPanel } from "@/components/vault/IdentityPanel";

export const metadata = { title: "Your key · Kinfold" };

export default function IdentityPage() {
  return (
    <Page title="Your key" back={{ href: "/", label: "Home" }}>
      <IdentityPanel />
    </Page>
  );
}
