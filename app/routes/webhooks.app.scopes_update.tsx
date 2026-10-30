import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session } = await authenticate.webhook(request);

    const current = payload.current as string[] | undefined;
    if (session && Array.isArray(current)) {
        // updateMany: the session may already be gone (uninstall), and a webhook must not fail on that.
        await db.session.updateMany({
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};
