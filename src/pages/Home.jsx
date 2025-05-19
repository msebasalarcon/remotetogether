import { useNavigate } from "react-router-dom";

export default function Home() {
    const navigate = useNavigate();

    const handleCreateRoom = () => {
        navigate("/room"); // No roomId → Person A
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1 className="text-2xl font-bold mb-6">Welcome to the Video Room App</h1>
            <button
                onClick={handleCreateRoom}
                className="px-4 py-2 bg-blue-600 text-white rounded shadow"
            >
                Create a Room (Person A)
            </button>
        </div>
    );
}
