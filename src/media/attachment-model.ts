import { Model } from '@bunnykit/orm';

export interface AttachmentAttributes {
	id: string;
	attachable_type: string;
	attachable_id: string;
	collection: string;
	provider: string;
	bucket_name: string;
	key: string;
	original_name: string;
	mime_type: string;
	original_mime_type?: string | null;
	extension?: string | null;
	size_bytes: number;
	original_size_bytes?: number | null;
	checksum?: string | null;
	visibility: 'public' | 'private';
	width?: number | null;
	height?: number | null;
	format?: string | null;
	metadata?: string | null;
	sort_order: number;
	uploaded_by_id?: string | null;
	deleted_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

export default class Attachment extends Model.define<AttachmentAttributes>('attachments') {}
