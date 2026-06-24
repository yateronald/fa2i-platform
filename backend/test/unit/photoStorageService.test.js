import { describe, it, expect, vi } from 'vitest';
import { storeImage } from '../../src/services/photoStorageService.js';

describe('photoStorageService - storeImage()', () => {
  /**
   * Helper: create a mock upload function that resolves with the given result.
   */
  function mockUpload(resolveWith) {
    return vi.fn().mockResolvedValue(resolveWith);
  }

  /**
   * Helper: create a mock upload function that rejects with the given error.
   */
  function mockUploadReject(error) {
    return vi.fn().mockRejectedValue(error);
  }

  describe('success path', () => {
    it('returns a reference with the secure_url on successful upload', async () => {
      const fakeUrl = 'https://res.cloudinary.com/demo/image/upload/v1/logo/abc123.png';
      const upload = mockUpload({ secure_url: fakeUrl, public_id: 'logo/abc123' });

      const result = await storeImage('/path/to/file.png', 'logo', { upload });

      expect(result).toEqual({ reference: fakeUrl });
      expect(upload).toHaveBeenCalledWith('/path/to/file.png', {
        folder: 'logo',
        resource_type: 'image',
      });
    });

    it('uploads a Buffer by converting it to a base64 data URI', async () => {
      const fakeUrl = 'https://res.cloudinary.com/demo/image/upload/v1/candidate_photo/xyz.jpg';
      const upload = mockUpload({ secure_url: fakeUrl, public_id: 'candidate_photo/xyz' });

      const buf = Buffer.from('fake-image-data');
      const result = await storeImage(buf, 'candidate_photo', { upload });

      expect(result).toEqual({ reference: fakeUrl });

      const expectedDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      expect(upload).toHaveBeenCalledWith(expectedDataUri, {
        folder: 'candidate_photo',
        resource_type: 'image',
      });
    });

    it('uploads a base64 data URI string directly', async () => {
      const fakeUrl = 'https://res.cloudinary.com/demo/image/upload/v1/logo/def456.png';
      const upload = mockUpload({ secure_url: fakeUrl, public_id: 'logo/def456' });

      const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      const result = await storeImage(dataUri, 'logo', { upload });

      expect(result).toEqual({ reference: fakeUrl });
      expect(upload).toHaveBeenCalledWith(dataUri, {
        folder: 'logo',
        resource_type: 'image',
      });
    });
  });

  describe('failure path', () => {
    it('returns reference:null and an error message when upload throws', async () => {
      const upload = mockUploadReject(new Error('Network timeout'));

      const result = await storeImage('/path/to/file.png', 'logo', { upload });

      expect(result).toEqual({ reference: null, error: 'Network timeout' });
    });

    it('returns reference:null with a generic message when error has no message', async () => {
      const upload = mockUploadReject({});

      const result = await storeImage('/path/to/file.png', 'candidate_photo', { upload });

      expect(result).toEqual({ reference: null, error: 'Unknown upload error' });
    });

    it('does not throw — callers can inspect the result to decide on rollback', async () => {
      const upload = mockUploadReject(new Error('Invalid image file'));

      // Should not throw
      const result = await storeImage('/bad/file.txt', 'logo', { upload });

      expect(result.reference).toBeNull();
      expect(result.error).toBe('Invalid image file');
    });
  });

  describe('folder routing by kind', () => {
    it('uses "logo" as the Cloudinary folder when kind is "logo"', async () => {
      const upload = mockUpload({ secure_url: 'https://example.com/img.png' });

      await storeImage('/img.png', 'logo', { upload });

      expect(upload).toHaveBeenCalledWith(
        '/img.png',
        expect.objectContaining({ folder: 'logo' })
      );
    });

    it('uses "candidate_photo" as the Cloudinary folder when kind is "candidate_photo"', async () => {
      const upload = mockUpload({ secure_url: 'https://example.com/img.png' });

      await storeImage('/img.png', 'candidate_photo', { upload });

      expect(upload).toHaveBeenCalledWith(
        '/img.png',
        expect.objectContaining({ folder: 'candidate_photo' })
      );
    });
  });
});
