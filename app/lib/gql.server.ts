/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL payloads are untyped JSON at this boundary */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

// Thin wrapper over admin.graphql: returns typed data, throws on top-level
// GraphQL errors, and surfaces mutation userErrors so callers can decide.

export type Admin = Pick<AdminApiContext, "graphql">;
export type UserError = { field?: string[] | null; message: string; code?: string | null };

export class GqlError extends Error {
  constructor(message: string, readonly errors: unknown) {
    super(message);
    this.name = "GqlError";
  }
}

export class UserErrorsError extends Error {
  constructor(readonly operation: string, readonly userErrors: UserError[]) {
    super(`${operation}: ${userErrors.map((e) => `${e.code ?? "ERROR"} ${e.message}`).join("; ")}`);
    this.name = "UserErrorsError";
  }
  hasCode(code: string): boolean {
    return this.userErrors.some((e) => e.code === code);
  }
}

export async function gql<T = any>(admin: Admin, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new GqlError("GraphQL error", json.errors);
  if (!json.data) throw new GqlError("GraphQL returned no data", null);
  return json.data;
}

/** Run a mutation and throw UserErrorsError if `data[field].userErrors` is non-empty. Returns `data[field]`. */
export async function mutate<T = any>(
  admin: Admin,
  field: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const data = await gql<Record<string, any>>(admin, query, variables);
  const payload = data[field];
  const errs: UserError[] = payload?.userErrors ?? [];
  if (errs.length) throw new UserErrorsError(field, errs);
  return payload as T;
}

/** Collect every node of a connection, page by page, up to `max` items. */
export async function paginate<N>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown>,
  pick: (data: any) => { nodes: N[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } },
  max = 1000,
): Promise<N[]> {
  const out: N[] = [];
  let after: string | null = null;
  do {
    const conn = pick(await gql(admin, query, { ...variables, after }));
    out.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after && out.length < max);
  return out.slice(0, max);
}

export const numericId = (gid: string) => gid.split("/").pop()!;
