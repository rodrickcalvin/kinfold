import { Page } from "@/components/vault/ui";
import { NewTreeForm } from "@/components/vault/NewTreeForm";

export const metadata = { title: "New tree · Kinfold" };

export default function NewVaultTreePage() {
  return (
    <Page title="New encrypted tree" back={{ href: "/", label: "Home" }}>
      <NewTreeForm />
    </Page>
  );
}
