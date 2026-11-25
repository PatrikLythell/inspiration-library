import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_moodboards_status" AS ENUM('brief', 'generating', 'done', 'failed');
  CREATE TABLE "moodboards_tiles" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"title" varchar,
  	"prompt" varchar,
  	"image_id" integer,
  	"error" varchar
  );
  
  CREATE TABLE "moodboards" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"board_id" integer,
  	"status" "enum_moodboards_status" DEFAULT 'brief',
  	"brief" jsonb NOT NULL,
  	"model" varchar,
  	"cost" numeric,
  	"owner_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "moodboards_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "moodboards_id" integer;
  ALTER TABLE "moodboards_tiles" ADD CONSTRAINT "moodboards_tiles_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "moodboards_tiles" ADD CONSTRAINT "moodboards_tiles_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."moodboards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "moodboards" ADD CONSTRAINT "moodboards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "moodboards" ADD CONSTRAINT "moodboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "moodboards_rels" ADD CONSTRAINT "moodboards_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."moodboards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "moodboards_rels" ADD CONSTRAINT "moodboards_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "moodboards_tiles_order_idx" ON "moodboards_tiles" USING btree ("_order");
  CREATE INDEX "moodboards_tiles_parent_id_idx" ON "moodboards_tiles" USING btree ("_parent_id");
  CREATE INDEX "moodboards_tiles_image_idx" ON "moodboards_tiles" USING btree ("image_id");
  CREATE INDEX "moodboards_board_idx" ON "moodboards" USING btree ("board_id");
  CREATE INDEX "moodboards_owner_idx" ON "moodboards" USING btree ("owner_id");
  CREATE INDEX "moodboards_updated_at_idx" ON "moodboards" USING btree ("updated_at");
  CREATE INDEX "moodboards_created_at_idx" ON "moodboards" USING btree ("created_at");
  CREATE INDEX "moodboards_rels_order_idx" ON "moodboards_rels" USING btree ("order");
  CREATE INDEX "moodboards_rels_parent_idx" ON "moodboards_rels" USING btree ("parent_id");
  CREATE INDEX "moodboards_rels_path_idx" ON "moodboards_rels" USING btree ("path");
  CREATE INDEX "moodboards_rels_users_id_idx" ON "moodboards_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_moodboards_fk" FOREIGN KEY ("moodboards_id") REFERENCES "public"."moodboards"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_moodboards_id_idx" ON "payload_locked_documents_rels" USING btree ("moodboards_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "moodboards_tiles" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "moodboards" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "moodboards_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "moodboards_tiles" CASCADE;
  DROP TABLE "moodboards" CASCADE;
  DROP TABLE "moodboards_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_moodboards_fk";
  
  DROP INDEX "payload_locked_documents_rels_moodboards_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "moodboards_id";
  DROP TYPE "public"."enum_moodboards_status";`)
}
