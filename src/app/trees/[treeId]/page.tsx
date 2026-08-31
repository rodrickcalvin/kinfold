import { notFound } from "next/navigation";
import { currentUid } from "@/auth";
import { store } from "@/lib/store";
import { redactTree } from "@/lib/visibility";
import { layoutTree } from "@/lib/layout";
import TreeExplorer from "@/components/TreeExplorer";

export const dynamic = "force-dynamic";

export default async function TreePage({
  params,
}: {
  params: Promise<{ treeId: string }>;
}) {
  const { treeId } = await params;
  const uid = await currentUid();

  const [tree, access] = await Promise.all([
    store.getTree(treeId).catch(() => null),
    store.getAccess(treeId).catch(() => null),
  ]);

  /**
   * Note the 404 rather than a 403.
   *
   * "You are not allowed to see this" confirms the tree exists, which tells a
   * stranger that a family by that name is on here. For genealogy that is a
   * real leak — it is how you confirm a relative you were told to leave alone.
   * So an unauthorised visitor and a nonexistent tree get the same answer.
   */
  if (!tree) notFound();

  // Redaction happens here, on the server. Whatever this returns is exactly
  // what the browser receives — there is nothing hidden in the payload.
  const visible = redactTree(tree, access, uid);
  if (!visible) notFound();

  const layout = layoutTree(visible);

  return (
    <TreeExplorer
      layout={layout}
      treeName={visible.name}
      viewer={visible.viewer}
    />
  );
}
