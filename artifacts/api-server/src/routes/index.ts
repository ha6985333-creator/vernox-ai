import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import authRouter from "./auth";
import adminRouter from "./admin";
import webhooksRouter from "./webhooks";
import embedRouter from "./embed";
import reviewsRouter from "./reviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(authRouter);
router.use(embedRouter);
router.use(webhooksRouter);
router.use("/admin", adminRouter);
router.use(reviewsRouter);

export default router;
