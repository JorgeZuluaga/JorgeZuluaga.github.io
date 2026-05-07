#!/usr/bin/env python3
import json

lib_data = json.loads(open("info/library.json").read())
det_data = json.loads(open("info/library-details.json").read())

# Build cross-reference maps (same as in export script)
isbn_to_details_bookid = {}
for b in det_data.get("books",[]):
    if b and b.get("ISBN"):
        isbn = str(b.get("ISBN","")).strip()
        bid = str(b.get("bookId","")).strip()
        if isbn and bid:
            isbn_to_details_bookid[isbn] = bid

bookid_to_isbn = {}
for b in lib_data.get("books",[]):
    if b and b.get("bookId"):
        bid = str(b.get("bookId","")).strip()
        isbn = str(b.get("ISBN", b.get("isbn","")) or "").strip()
        if bid and isbn:
            bookid_to_isbn[bid] = isbn

print(f"isbn_to_details_bookid mappings: {len(isbn_to_details_bookid)}")
print(f"bookid_to_isbn mappings: {len(bookid_to_isbn)}")

# Check the Feynman book
test_isbn = "9780393355680"
print(f"\nLooking for ISBN {test_isbn}:")
print(f"  In isbn_to_details_bookid? {test_isbn in isbn_to_details_bookid}")
if test_isbn in isbn_to_details_bookid:
    print(f"  Maps to bookId: {isbn_to_details_bookid[test_isbn]}")

# Check if this ISBN appears in library.json
lib_with_isbn = [b for b in lib_data.get("books",[]) 
                  if str(b.get("ISBN","")).strip() == test_isbn 
                  or str(b.get("isbn","")).strip() == test_isbn]
print(f"  Books in library.json with ISBN {test_isbn}: {len(lib_with_isbn)}")

# Check library-details.json
det_with_isbn = [b for b in det_data.get("books",[])
                  if str(b.get("ISBN","")).strip() == test_isbn]
print(f"  Books in library-details.json with ISBN {test_isbn}: {len(det_with_isbn)}")
if det_with_isbn:
    print(f"    -> bookId: {det_with_isbn[0].get('bookId')}")

# Check a library.json book that should have a cross ref
lib_books_with_isbn = [b for b in lib_data.get("books",[]) if b.get("ISBN") or b.get("isbn")]
print(f"\nLibrary.json books with ISBN: {len(lib_books_with_isbn)}")
if lib_books_with_isbn:
    sample = lib_books_with_isbn[0]
    isbn = str(sample.get("ISBN") or sample.get("isbn") or "").strip()
    bid = str(sample.get("bookId", "")).strip()
    print(f"Sample book: {sample.get('title')}")
    print(f"  bookId: {bid}, ISBN: {isbn}")
    print(f"  Cross-ref should be: {isbn_to_details_bookid.get(isbn, 'NOT FOUND')}")
