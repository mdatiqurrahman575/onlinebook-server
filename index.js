import express from "express";
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import cors from 'cors';
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);


async function connectToMongoDB() {
    try {
        if (!client.topology || !client.topology.isConnected()) {
            await client.connect();
            console.log("You successfully connected to MongoDB!");
        }
        return client.db('onlinebookBD');
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
        throw err;
    }
}


const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).send({ success: false, message: "Unauthorized! No token provided." });
        }
        const tokenParts = authHeader.split(" ");
        const token = tokenParts[1];
        if (!token) {
            return res.status(401).send({ success: false, message: "Unauthorized! Invalid token format." });
        }
        const authUrl = process.env.BETTER_AUTH_URL;
        if (!authUrl) {
            return res.status(500).send({ success: false, message: "Internal Server Configuration Error." });
        }
        const JWKS = createRemoteJWKSet(new URL(`${authUrl}/api/auth/jwks`));
        const { payload } = await jwtVerify(token, JWKS);
        console.log("🟢 ভেরিফাইড ইউজার পে-লোড ব্যাকএন্ডে:", payload);
        req.user = payload;
        next();
    } catch (error) {
        return res.status(403).send({ success: false, message: "Forbidden! Invalid or expired token." });
    }
};


app.get('/', (req, res) => {
    res.send({ message: "Server is running fine!" });
});


app.post('/books', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");

        const bookData = req.body;
        const totalCopies = parseInt(bookData.quantity) || 1;
        const finalBook = {
            title: bookData.title,
            author: bookData.author,
            category: bookData.category,
            image: bookData.image,
            description: bookData.description,
            userName: bookData.userName,
            userEmail: bookData.userEmail,
            totalCopies: totalCopies,
            availableCopies: totalCopies,
            addedAt: new Date()
        };
        const result = await bookcollection.insertOne(finalBook);
        res.status(201).send({ success: true, message: "Book added successfully!", insertedId: result.insertedId });
    } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Failed to add book." });
    }
});


app.get('/books', async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");

        const result = await bookcollection.find().toArray();
        res.send(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error fetching books data" });
    }
});


app.get('/books/:id', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");

        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid Book ID format" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await bookcollection.findOne(query);
        if (!result) {
            return res.status(404).send({ message: "Book not found" });
        }
        res.send(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});


app.post('/borrows', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");
        const borrowcollection = db.collection("borrows");

        const borrowData = req.body;
        const alreadyBorrowed = await borrowcollection.findOne({ bookId: borrowData.bookId, userEmail: borrowData.userEmail });
        if (alreadyBorrowed) {
            return res.status(400).send({ success: false, message: "You have already borrowed this book!" });
        }
        const bookQuery = { _id: new ObjectId(borrowData.bookId) };
        const targetBook = await bookcollection.findOne(bookQuery);
        if (!targetBook || targetBook.availableCopies <= 0) {
            return res.status(400).send({ success: false, message: "Sorry, this book is out of stock!" });
        }
        await bookcollection.updateOne(bookQuery, { $inc: { availableCopies: -1 } });
        const finalBorrowDoc = {
            bookId: borrowData.bookId,
            bookTitle: borrowData.bookTitle,
            bookImage: borrowData.bookImage,
            userEmail: borrowData.userEmail,
            userName: borrowData.userName,
            borrowDate: new Date(borrowData.borrowDate),
            returnDate: new Date(borrowData.returnDate),
            status: "Borrowed"
        };
        const result = await borrowcollection.insertOne(finalBorrowDoc);
        res.status(201).send({ success: true, message: "Book borrowed successfully!", insertedId: result.insertedId });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error during borrowing." });
    }
});


app.get('/borrows', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const borrowcollection = db.collection("borrows");

        const email = req.query.email;
        if (!email) {
            return res.status(400).send({ message: "Email query parameter is required" });
        }
        const query = { userEmail: email };
        const result = await borrowcollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error fetching borrowed books" });
    }
});


app.delete('/borrows/:id', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");
        const borrowcollection = db.collection("borrows");

        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid Borrow ID format" });
        }
        const borrowQuery = { _id: new ObjectId(id) };
        const borrowRecord = await borrowcollection.findOne(borrowQuery);
        if (!borrowRecord) {
            return res.status(404).send({ message: "Borrow record not found" });
        }
        const bookQuery = { _id: new ObjectId(borrowRecord.bookId) };
        await bookcollection.updateOne(bookQuery, { $inc: { availableCopies: 1 } });
        const result = await borrowcollection.deleteOne(borrowQuery);
        res.send({ success: true, message: "Book returned successfully!", result });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error during return process" });
    }
});


app.get('/my-books', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");

        const email = req.query.email;
        if (!email) {
            return res.status(400).send({ message: "Email query parameter is required" });
        }
        const query = { userEmail: email };
        const result = await bookcollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error fetching user books" });
    }
});

app.patch('/books/:id', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");

        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid Book ID format" });
        }
        const filter = { _id: new ObjectId(id) };
        const updatedData = req.body;
        const updateDoc = {
            $set: {
                title: updatedData.title,
                author: updatedData.author,
                category: updatedData.category,
                image: updatedData.image,
                description: updatedData.description,
                totalCopies: parseInt(updatedData.totalCopies) || 1,
                availableCopies: parseInt(updatedData.totalCopies) || 1,
            },
        };
        const result = await bookcollection.updateOne(filter, updateDoc);
        res.send({ success: true, message: "Book updated successfully!", result });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error updating book data" });
    }
});


app.delete('/books/:id', verifyToken, async (req, res) => {
    try {
        const db = await connectToMongoDB();
        const bookcollection = db.collection("books");

        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid Book ID format" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await bookcollection.deleteOne(query);
        res.send({ success: true, message: "Book deleted successfully!", result });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error deleting book" });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}

export default app;