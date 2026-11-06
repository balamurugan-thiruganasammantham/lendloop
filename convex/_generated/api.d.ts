/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as automation from "../automation.js";
import type * as crons from "../crons.js";
import type * as devMailbox from "../devMailbox.js";
import type * as email from "../email.js";
import type * as emailNode from "../emailNode.js";
import type * as feedback from "../feedback.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_loans from "../lib/loans.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_projections from "../lib/projections.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_sanitize from "../lib/sanitize.js";
import type * as lib_stateMachine from "../lib/stateMachine.js";
import type * as lib_stats from "../lib/stats.js";
import type * as lib_toolStatus from "../lib/toolStatus.js";
import type * as loans from "../loans.js";
import type * as notifications from "../notifications.js";
import type * as otp from "../otp.js";
import type * as otpActions from "../otpActions.js";
import type * as requests from "../requests.js";
import type * as scheduled from "../scheduled.js";
import type * as seed from "../seed.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";
import type * as validators_index from "../validators/index.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  automation: typeof automation;
  crons: typeof crons;
  devMailbox: typeof devMailbox;
  email: typeof email;
  emailNode: typeof emailNode;
  feedback: typeof feedback;
  files: typeof files;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/crypto": typeof lib_crypto;
  "lib/errors": typeof lib_errors;
  "lib/geo": typeof lib_geo;
  "lib/loans": typeof lib_loans;
  "lib/notify": typeof lib_notify;
  "lib/projections": typeof lib_projections;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/rules": typeof lib_rules;
  "lib/sanitize": typeof lib_sanitize;
  "lib/stateMachine": typeof lib_stateMachine;
  "lib/stats": typeof lib_stats;
  "lib/toolStatus": typeof lib_toolStatus;
  loans: typeof loans;
  notifications: typeof notifications;
  otp: typeof otp;
  otpActions: typeof otpActions;
  requests: typeof requests;
  scheduled: typeof scheduled;
  seed: typeof seed;
  tools: typeof tools;
  users: typeof users;
  "validators/index": typeof validators_index;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
