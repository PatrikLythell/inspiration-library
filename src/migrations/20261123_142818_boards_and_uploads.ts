import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "boards_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"reference_id" integer NOT NULL,
  	"note" varchar
  );
  
  CREATE TABLE "boards" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"parent_id" integer,
  	"description" varchar,
  	"owner_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "boards_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "_boards_v_version_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"reference_id" integer NOT NULL,
  	"note" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_boards_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_name" varchar NOT NULL,
  	"version_parent_id" integer,
  	"version_description" varchar,
  	"version_owner_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_boards_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "references" ADD COLUMN "added_by_id" integer;
  ALTER TABLE "_references_v" ADD COLUMN "version_added_by_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "boards_id" integer;
  ALTER TABLE "boards_items" ADD CONSTRAINT "boards_items_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "boards_items" ADD CONSTRAINT "boards_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "boards" ADD CONSTRAINT "boards_parent_id_boards_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "boards_rels" ADD CONSTRAINT "boards_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "boards_rels" ADD CONSTRAINT "boards_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_boards_v_version_items" ADD CONSTRAINT "_boards_v_version_items_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v_version_items" ADD CONSTRAINT "_boards_v_version_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_boards_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_boards_v" ADD CONSTRAINT "_boards_v_parent_id_boards_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v" ADD CONSTRAINT "_boards_v_version_parent_id_boards_id_fk" FOREIGN KEY ("version_parent_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v" ADD CONSTRAINT "_boards_v_version_owner_id_users_id_fk" FOREIGN KEY ("version_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v_rels" ADD CONSTRAINT "_boards_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_boards_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_boards_v_rels" ADD CONSTRAINT "_boards_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "boards_items_order_idx" ON "boards_items" USING btree ("_order");
  CREATE INDEX "boards_items_parent_id_idx" ON "boards_items" USING btree ("_parent_id");
  CREATE INDEX "boards_items_reference_idx" ON "boards_items" USING btree ("reference_id");
  CREATE INDEX "boards_parent_idx" ON "boards" USING btree ("parent_id");
  CREATE INDEX "boards_owner_idx" ON "boards" USING btree ("owner_id");
  CREATE INDEX "boards_updated_at_idx" ON "boards" USING btree ("updated_at");
  CREATE INDEX "boards_created_at_idx" ON "boards" USING btree ("created_at");
  CREATE INDEX "boards_rels_order_idx" ON "boards_rels" USING btree ("order");
  CREATE INDEX "boards_rels_parent_idx" ON "boards_rels" USING btree ("parent_id");
  CREATE INDEX "boards_rels_path_idx" ON "boards_rels" USING btree ("path");
  CREATE INDEX "boards_rels_users_id_idx" ON "boards_rels" USING btree ("users_id");
  CREATE INDEX "_boards_v_version_items_order_idx" ON "_boards_v_version_items" USING btree ("_order");
  CREATE INDEX "_boards_v_version_items_parent_id_idx" ON "_boards_v_version_items" USING btree ("_parent_id");
  CREATE INDEX "_boards_v_version_items_reference_idx" ON "_boards_v_version_items" USING btree ("reference_id");
  CREATE INDEX "_boards_v_parent_idx" ON "_boards_v" USING btree ("parent_id");
  CREATE INDEX "_boards_v_version_version_parent_idx" ON "_boards_v" USING btree ("version_parent_id");
  CREATE INDEX "_boards_v_version_version_owner_idx" ON "_boards_v" USING btree ("version_owner_id");
  CREATE INDEX "_boards_v_version_version_updated_at_idx" ON "_boards_v" USING btree ("version_updated_at");
  CREATE INDEX "_boards_v_version_version_created_at_idx" ON "_boards_v" USING btree ("version_created_at");
  CREATE INDEX "_boards_v_created_at_idx" ON "_boards_v" USING btree ("created_at");
  CREATE INDEX "_boards_v_updated_at_idx" ON "_boards_v" USING btree ("updated_at");
  CREATE INDEX "_boards_v_rels_order_idx" ON "_boards_v_rels" USING btree ("order");
  CREATE INDEX "_boards_v_rels_parent_idx" ON "_boards_v_rels" USING btree ("parent_id");
  CREATE INDEX "_boards_v_rels_path_idx" ON "_boards_v_rels" USING btree ("path");
  CREATE INDEX "_boards_v_rels_users_id_idx" ON "_boards_v_rels" USING btree ("users_id");
  ALTER TABLE "references" ADD CONSTRAINT "references_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_references_v" ADD CONSTRAINT "_references_v_version_added_by_id_users_id_fk" FOREIGN KEY ("version_added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_boards_fk" FOREIGN KEY ("boards_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "references_added_by_idx" ON "references" USING btree ("added_by_id");
  CREATE INDEX "_references_v_version_version_added_by_idx" ON "_references_v" USING btree ("version_added_by_id");
  CREATE INDEX "payload_locked_documents_rels_boards_id_idx" ON "payload_locked_documents_rels" USING btree ("boards_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "boards_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "boards" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "boards_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_boards_v_version_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_boards_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_boards_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "boards_items" CASCADE;
  DROP TABLE "boards" CASCADE;
  DROP TABLE "boards_rels" CASCADE;
  DROP TABLE "_boards_v_version_items" CASCADE;
  DROP TABLE "_boards_v" CASCADE;
  DROP TABLE "_boards_v_rels" CASCADE;
  ALTER TABLE "references" DROP CONSTRAINT "references_added_by_id_users_id_fk";
  
  ALTER TABLE "_references_v" DROP CONSTRAINT "_references_v_version_added_by_id_users_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_boards_fk";
  
  DROP INDEX "references_added_by_idx";
  DROP INDEX "_references_v_version_version_added_by_idx";
  DROP INDEX "payload_locked_documents_rels_boards_id_idx";
  ALTER TABLE "references" DROP COLUMN "added_by_id";
  ALTER TABLE "_references_v" DROP COLUMN "version_added_by_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "boards_id";`)
}
