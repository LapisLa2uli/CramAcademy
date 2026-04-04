from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from config import get_settings
from routers import admin, auth, health, profile, questions, question_sets, subjects, tests, submissions, protests

app = FastAPI(
    title="CramAcademy API",
    description="AI-powered exam and review platform",
    version="1.0.0",
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(profile.router, prefix="/profile", tags=["Profile"])
app.include_router(admin.router, prefix="/admin", tags=["Admin"])
app.include_router(subjects.router, prefix="/subjects", tags=["Subjects"])
app.include_router(questions.router, prefix="/questions", tags=["Questions"])
app.include_router(question_sets.router, prefix="/question-sets", tags=["Question Sets"])
app.include_router(tests.router, prefix="/tests", tags=["Tests"])
app.include_router(submissions.router, prefix="/submissions", tags=["Submissions"])
app.include_router(protests.router, prefix="/protests", tags=["Protests"])


@app.get("/")
async def root():
    """OpenAPI UI is the default landing page for the API server."""
    return RedirectResponse(url="/docs")


