import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "_references_v" CASCADE;
  DROP TABLE "_references_v_rels" CASCADE;
  DROP TABLE "_boards_v_version_items" CASCADE;
  DROP TABLE "_boards_v" CASCADE;
  DROP TABLE "_boards_v_rels" CASCADE;
  DROP TABLE "_media_v" CASCADE;
  DROP TABLE "_media_v_rels" CASCADE;
  DROP TABLE "_folders_v" CASCADE;
  DROP TABLE "_folders_v_rels" CASCADE;
  DROP TABLE "_tags_v" CASCADE;
  DROP TABLE "_tags_v_rels" CASCADE;
  DROP TYPE "public"."enum__references_v_version_source";
  DROP TYPE "public"."enum__references_v_version_storage";
  DROP TYPE "public"."enum__references_v_version_status";  -- 1536-dim vectors only: drop the full 3072 values (search reads embedding_1536).
  UPDATE "references" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;
`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum__references_v_version_source" AS ENUM('brandarchive', 'visualjournal', 'creativeboom', 'upload');
  CREATE TYPE "public"."enum__references_v_version_storage" AS ENUM('hosted', 'linked');
  CREATE TYPE "public"."enum__references_v_version_status" AS ENUM('active', 'hidden', 'duplicate', 'dead-link');
  CREATE TABLE "_references_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_source_key" varchar NOT NULL,
  	"version_source" "enum__references_v_version_source" NOT NULL,
  	"version_storage" "enum__references_v_version_storage" DEFAULT 'hosted' NOT NULL,
  	"version_status" "enum__references_v_version_status" DEFAULT 'active',
  	"version_image_id" integer,
  	"version_external_image_thumb" varchar,
  	"version_external_image_small" varchar,
  	"version_external_image_large" varchar,
  	"version_external_image_original" varchar,
  	"version_external_image_width" numeric,
  	"version_external_image_height" numeric,
  	"version_description" varchar,
  	"version_tags" jsonb,
  	"version_palette" jsonb,
  	"version_dominant_color" varchar,
  	"version_provenance_brand" varchar,
  	"version_provenance_year" numeric,
  	"version_provenance_designers" jsonb,
  	"version_provenance_source_url" varchar,
  	"version_provenance_article_url" varchar,
  	"version_provenance_credit" varchar,
  	"version_added_by_id" integer,
  	"version_width" numeric,
  	"version_height" numeric,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_references_v_rels" (
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
  
  CREATE TABLE "_media_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_alt" varchar,
  	"version__h_folders_id" integer,
  	"version_prefix" varchar DEFAULT '',
  	"version__objectkey" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version_url" varchar,
  	"version_thumbnail_u_r_l" varchar,
  	"version_filename" varchar,
  	"version_mime_type" varchar,
  	"version_filesize" numeric,
  	"version_width" numeric,
  	"version_height" numeric,
  	"version__stored" boolean,
  	"version__transforms" jsonb,
  	"version_original_filename" varchar,
  	"version_original_url" varchar,
  	"version_original_mime_type" varchar,
  	"version_original_filesize" numeric,
  	"version_original_width" numeric,
  	"version_original_height" numeric,
  	"version_original_prefix" varchar,
  	"version_original__objectkey" varchar,
  	"version_original__stored" boolean,
  	"version_focal_x" numeric,
  	"version_focal_y" numeric,
  	"version_variants_thumb_url" varchar,
  	"version_variants_thumb_width" numeric,
  	"version_variants_thumb_height" numeric,
  	"version_variants_thumb_mime_type" varchar,
  	"version_variants_thumb_filesize" numeric,
  	"version_variants_thumb_filename" varchar,
  	"version_variants_thumb_prefix" varchar,
  	"version_variants_thumb__objectkey" varchar,
  	"version_variants_thumb__stored" boolean,
  	"version_variants_grid_url" varchar,
  	"version_variants_grid_width" numeric,
  	"version_variants_grid_height" numeric,
  	"version_variants_grid_mime_type" varchar,
  	"version_variants_grid_filesize" numeric,
  	"version_variants_grid_filename" varchar,
  	"version_variants_grid_prefix" varchar,
  	"version_variants_grid__objectkey" varchar,
  	"version_variants_grid__stored" boolean,
  	"version_variants_large_url" varchar,
  	"version_variants_large_width" numeric,
  	"version_variants_large_height" numeric,
  	"version_variants_large_mime_type" varchar,
  	"version_variants_large_filesize" numeric,
  	"version_variants_large_filename" varchar,
  	"version_variants_large_prefix" varchar,
  	"version_variants_large__objectkey" varchar,
  	"version_variants_large__stored" boolean,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_media_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"tags_id" integer,
  	"users_id" integer
  );
  
  CREATE TABLE "_folders_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version__h_folders_id" integer,
  	"version_name" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_folders_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "_tags_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version__h_tags_id" integer,
  	"version_name" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_tags_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "_references_v" ADD CONSTRAINT "_references_v_parent_id_references_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."references"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_references_v" ADD CONSTRAINT "_references_v_version_image_id_media_id_fk" FOREIGN KEY ("version_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_references_v" ADD CONSTRAINT "_references_v_version_added_by_id_users_id_fk" FOREIGN KEY ("version_added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_references_v_rels" ADD CONSTRAINT "_references_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_references_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_references_v_rels" ADD CONSTRAINT "_references_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_boards_v_version_items" ADD CONSTRAINT "_boards_v_version_items_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v_version_items" ADD CONSTRAINT "_boards_v_version_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_boards_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_boards_v" ADD CONSTRAINT "_boards_v_parent_id_boards_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v" ADD CONSTRAINT "_boards_v_version_parent_id_boards_id_fk" FOREIGN KEY ("version_parent_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v" ADD CONSTRAINT "_boards_v_version_owner_id_users_id_fk" FOREIGN KEY ("version_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_boards_v_rels" ADD CONSTRAINT "_boards_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_boards_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_boards_v_rels" ADD CONSTRAINT "_boards_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v" ADD CONSTRAINT "_media_v_parent_id_media_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_v" ADD CONSTRAINT "_media_v_version__h_folders_id_folders_id_fk" FOREIGN KEY ("version__h_folders_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_media_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_tags_fk" FOREIGN KEY ("tags_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_folders_v" ADD CONSTRAINT "_folders_v_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_folders_v" ADD CONSTRAINT "_folders_v_version__h_folders_id_folders_id_fk" FOREIGN KEY ("version__h_folders_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_folders_v_rels" ADD CONSTRAINT "_folders_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_folders_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_folders_v_rels" ADD CONSTRAINT "_folders_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_tags_v" ADD CONSTRAINT "_tags_v_parent_id_tags_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_tags_v" ADD CONSTRAINT "_tags_v_version__h_tags_id_tags_id_fk" FOREIGN KEY ("version__h_tags_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_tags_v_rels" ADD CONSTRAINT "_tags_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_tags_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_tags_v_rels" ADD CONSTRAINT "_tags_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_references_v_parent_idx" ON "_references_v" USING btree ("parent_id");
  CREATE INDEX "_references_v_version_version_source_key_idx" ON "_references_v" USING btree ("version_source_key");
  CREATE INDEX "_references_v_version_version_source_idx" ON "_references_v" USING btree ("version_source");
  CREATE INDEX "_references_v_version_version_status_idx" ON "_references_v" USING btree ("version_status");
  CREATE INDEX "_references_v_version_version_image_idx" ON "_references_v" USING btree ("version_image_id");
  CREATE INDEX "_references_v_version_provenance_version_provenance_bran_idx" ON "_references_v" USING btree ("version_provenance_brand");
  CREATE INDEX "_references_v_version_version_added_by_idx" ON "_references_v" USING btree ("version_added_by_id");
  CREATE INDEX "_references_v_version_version_updated_at_idx" ON "_references_v" USING btree ("version_updated_at");
  CREATE INDEX "_references_v_version_version_created_at_idx" ON "_references_v" USING btree ("version_created_at");
  CREATE INDEX "_references_v_created_at_idx" ON "_references_v" USING btree ("created_at");
  CREATE INDEX "_references_v_updated_at_idx" ON "_references_v" USING btree ("updated_at");
  CREATE INDEX "_references_v_rels_order_idx" ON "_references_v_rels" USING btree ("order");
  CREATE INDEX "_references_v_rels_parent_idx" ON "_references_v_rels" USING btree ("parent_id");
  CREATE INDEX "_references_v_rels_path_idx" ON "_references_v_rels" USING btree ("path");
  CREATE INDEX "_references_v_rels_users_id_idx" ON "_references_v_rels" USING btree ("users_id");
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
  CREATE INDEX "_media_v_parent_idx" ON "_media_v" USING btree ("parent_id");
  CREATE INDEX "_media_v_version_version__h_folders_idx" ON "_media_v" USING btree ("version__h_folders_id");
  CREATE INDEX "_media_v_version_version_updated_at_idx" ON "_media_v" USING btree ("version_updated_at");
  CREATE INDEX "_media_v_version_version_created_at_idx" ON "_media_v" USING btree ("version_created_at");
  CREATE INDEX "_media_v_version_version_filename_idx" ON "_media_v" USING btree ("version_filename");
  CREATE INDEX "_media_v_version_original_version_original_filename_idx" ON "_media_v" USING btree ("version_original_filename");
  CREATE INDEX "_media_v_version_variants_thumb_version_variants_thumb_f_idx" ON "_media_v" USING btree ("version_variants_thumb_filename");
  CREATE INDEX "_media_v_version_variants_grid_version_variants_grid_fil_idx" ON "_media_v" USING btree ("version_variants_grid_filename");
  CREATE INDEX "_media_v_version_variants_large_version_variants_large_f_idx" ON "_media_v" USING btree ("version_variants_large_filename");
  CREATE INDEX "_media_v_created_at_idx" ON "_media_v" USING btree ("created_at");
  CREATE INDEX "_media_v_updated_at_idx" ON "_media_v" USING btree ("updated_at");
  CREATE INDEX "_media_v_rels_order_idx" ON "_media_v_rels" USING btree ("order");
  CREATE INDEX "_media_v_rels_parent_idx" ON "_media_v_rels" USING btree ("parent_id");
  CREATE INDEX "_media_v_rels_path_idx" ON "_media_v_rels" USING btree ("path");
  CREATE INDEX "_media_v_rels_tags_id_idx" ON "_media_v_rels" USING btree ("tags_id");
  CREATE INDEX "_media_v_rels_users_id_idx" ON "_media_v_rels" USING btree ("users_id");
  CREATE INDEX "_folders_v_parent_idx" ON "_folders_v" USING btree ("parent_id");
  CREATE INDEX "_folders_v_version_version__h_folders_idx" ON "_folders_v" USING btree ("version__h_folders_id");
  CREATE INDEX "_folders_v_version_version_updated_at_idx" ON "_folders_v" USING btree ("version_updated_at");
  CREATE INDEX "_folders_v_version_version_created_at_idx" ON "_folders_v" USING btree ("version_created_at");
  CREATE INDEX "_folders_v_created_at_idx" ON "_folders_v" USING btree ("created_at");
  CREATE INDEX "_folders_v_updated_at_idx" ON "_folders_v" USING btree ("updated_at");
  CREATE INDEX "_folders_v_rels_order_idx" ON "_folders_v_rels" USING btree ("order");
  CREATE INDEX "_folders_v_rels_parent_idx" ON "_folders_v_rels" USING btree ("parent_id");
  CREATE INDEX "_folders_v_rels_path_idx" ON "_folders_v_rels" USING btree ("path");
  CREATE INDEX "_folders_v_rels_users_id_idx" ON "_folders_v_rels" USING btree ("users_id");
  CREATE INDEX "_tags_v_parent_idx" ON "_tags_v" USING btree ("parent_id");
  CREATE INDEX "_tags_v_version_version__h_tags_idx" ON "_tags_v" USING btree ("version__h_tags_id");
  CREATE INDEX "_tags_v_version_version_updated_at_idx" ON "_tags_v" USING btree ("version_updated_at");
  CREATE INDEX "_tags_v_version_version_created_at_idx" ON "_tags_v" USING btree ("version_created_at");
  CREATE INDEX "_tags_v_created_at_idx" ON "_tags_v" USING btree ("created_at");
  CREATE INDEX "_tags_v_updated_at_idx" ON "_tags_v" USING btree ("updated_at");
  CREATE INDEX "_tags_v_rels_order_idx" ON "_tags_v_rels" USING btree ("order");
  CREATE INDEX "_tags_v_rels_parent_idx" ON "_tags_v_rels" USING btree ("parent_id");
  CREATE INDEX "_tags_v_rels_path_idx" ON "_tags_v_rels" USING btree ("path");
  CREATE INDEX "_tags_v_rels_users_id_idx" ON "_tags_v_rels" USING btree ("users_id");`)
}
