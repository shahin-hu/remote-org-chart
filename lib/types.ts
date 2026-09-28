/**
 * Domain types.
 *
 * These are OURS, not the API's. The Remote employment payload has 50+ fields
 * across banking, onboarding tasks, contracts and country-specific blocks. An org
 * chart needs six of them. Mapping at the boundary means the tree code never has
 * to know what an `EmploymentShowResponse` looks like, and a change on their side
 * lands in one adapter rather than everywhere.
 */

/** One employee, already flattened out of the API shape. */
export type Person = {
  id: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  status: string | null;
  /**
   * Where this person is employed. Remote's whole product is employing people
   * across borders without a local entity, so for this data set country is the
   * most informative field after name and title: 201 people across 15 countries.
   */
  country: string | null;
  /** Parent pointer. Null means "no manager recorded". */
  managerId: string | null;
  /**
   * Manager's name as the API reports it. Can be present while `managerId` is
   * null: the manager exists but is not employed through Remote, so there is no
   * node for them. We keep the name so the UI can say something truthful.
   */
  managerName: string | null;
};

/** A person placed in the tree. */
export type OrgNode = Person & {
  children: OrgNode[];
  /** Distance from the root that owns this subtree. Roots are 0. */
  depth: number;
  /** Total people in this subtree, including this one. */
  subtreeSize: number;
};

/**
 * Why a node ended up at the top level. Not every root is a CEO, and conflating
 * the two is how an org chart quietly lies.
 */
export type RootReason =
  /** managerId is null. A genuine top of the tree. */
  | 'no_manager'
  /** managerId points at someone who is not in our data set. */
  | 'orphaned'
  /** Part of a reporting cycle; we cut the edge so rendering can terminate. */
  | 'cycle_broken';

export type Diagnostics = {
  total: number;
  /** Roots, with the reason each one is a root. */
  roots: { id: string; name: string; reason: RootReason }[];
  /** managerId pointed outside the set. Keeps the dangling id for debugging. */
  orphans: { id: string; name: string; missingManagerId: string }[];
  /** Each detected cycle, as the ids involved. */
  cycles: string[][];
  /** Manager named but not present as a node. A real case, not a bug. */
  managersNotInRemote: { id: string; name: string; managerName: string }[];
  /** Sanity check: every person appears exactly once in the forest. */
  placed: number;
};

export type OrgForest = {
  roots: OrgNode[];
  diagnostics: Diagnostics;
};
